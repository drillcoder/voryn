import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { BlockJobsRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { BlockJobStatusCounts, FailedBlockMetrics } from "../../interfaces/metrics.js";
import type { BlockJob } from "../../interfaces/pipeline.js";
import type { BlockJobStatus } from "../../types/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface BlockJobRow {
    chain_id: number;
    block_number: bigint | number | string;
    status: BlockJobStatus;
    attempts: number;
    next_retry_at: Date | string | null;
    error: string | null;
    claimed_at: Date | string | null;
    updated_at: Date | string;
}

interface BlockJobMetricsRow {
    pending_count: bigint | number | string;
    fetching_count: bigint | number | string;
    fetched_count: bigint | number | string;
    committed_count: bigint | number | string;
    failed_count: bigint | number | string;
}

interface FailedBlockMetricsRow {
    block_number: bigint | number | string;
    attempts: number;
    error: string | null;
    next_retry_at: Date | string | null;
    updated_at: Date | string;
}

export class PostgresBlockJobsRepository implements BlockJobsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async get(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<BlockJob | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockJobRow>(
            `SELECT chain_id, block_number, status, attempts, next_retry_at, error, claimed_at, updated_at
             FROM block_jobs
             WHERE chain_id = $1
               AND block_number = $2`,
            [chainId, blockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapJob(result.rows[0]);
    }

    async enqueueRange(
        chainId: ChainId,
        fromBlock: BlockNumber,
        toBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<void> {
        if (fromBlock > toBlock) {
            return;
        }

        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO block_jobs (chain_id, block_number, status)
             SELECT $1, gs, 'pending'
             FROM generate_series($2::BIGINT, $3::BIGINT) AS gs
             ON CONFLICT (chain_id, block_number) DO NOTHING`,
            [chainId, fromBlock, toBlock]
        );
    }

    async claimForFetch(
        chainId: ChainId,
        instanceId: string,
        staleClaimedBefore: Date,
        transaction?: DbExecutor
    ): Promise<BlockJob | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockJobRow>(
            `WITH candidate AS (
                 SELECT chain_id, block_number
                 FROM block_jobs
                 WHERE chain_id = $1
                   AND (
                       status = 'pending'
                       OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
                       OR (status = 'fetching' AND claimed_at IS NOT NULL AND claimed_at <= $3)
                   )
                 ORDER BY block_number
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1
             )
             UPDATE block_jobs j
             SET status = 'fetching',
                 attempts = j.attempts + 1,
                 claimed_by = $2,
                 claimed_at = NOW(),
                 error = NULL,
                 next_retry_at = NULL,
                 updated_at = NOW()
             FROM candidate c
             WHERE j.chain_id = c.chain_id
               AND j.block_number = c.block_number
             RETURNING
                 j.chain_id,
                 j.block_number,
                 j.status,
                 j.attempts,
                 j.next_retry_at,
                 j.error,
                 j.claimed_at,
                 j.updated_at`,
            [chainId, instanceId, staleClaimedBefore]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapJob(result.rows[0]);
    }

    async markFetched(
        chainId: ChainId,
        blockNumber: BlockNumber,
        instanceId: string,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const result = await executor.query(
            `UPDATE block_jobs
             SET status = 'fetched',
                 claimed_by = NULL,
                 claimed_at = NULL,
                 error = NULL,
                 next_retry_at = NULL,
                 updated_at = NOW()
             WHERE chain_id = $1
               AND block_number = $2
               AND status = 'fetching'
               AND claimed_by = $3`,
            [chainId, blockNumber, instanceId]
        );

        if ((result.rowCount ?? 0) === 0) {
            throw new Error(
                `Cannot mark block job as fetched for chain ${String(chainId)} block ${String(blockNumber)}`
            );
        }
    }

    async markFetchFailed(
        chainId: ChainId,
        blockNumber: BlockNumber,
        instanceId: string,
        error: string,
        nextRetryAt: Date | null,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const result = await executor.query(
            `UPDATE block_jobs
             SET status = 'failed',
                 claimed_by = NULL,
                 claimed_at = NULL,
                 error = $4,
                 next_retry_at = $5,
                 updated_at = NOW()
             WHERE chain_id = $1
               AND block_number = $2
               AND status = 'fetching'
               AND claimed_by = $3`,
            [chainId, blockNumber, instanceId, error, nextRetryAt]
        );

        if ((result.rowCount ?? 0) === 0) {
            throw new Error(
                `Cannot mark block job as failed for chain ${String(chainId)} block ${String(blockNumber)}`
            );
        }
    }

    async markCommitted(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE block_jobs
             SET status = 'committed',
                 updated_at = NOW()
             WHERE chain_id = $1
               AND block_number = $2
               AND status <> 'committed'`,
            [chainId, blockNumber]
        );

        if ((updated.rowCount ?? 0) !== 1) {
            throw new Error(
                `Failed to mark block job as committed for chain ${String(chainId)} block ${String(blockNumber)}`
            );
        }
    }

    async getStatusCounts(chainId: ChainId, transaction?: DbExecutor): Promise<BlockJobStatusCounts> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockJobMetricsRow>(
            `SELECT
                 COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
                 COUNT(*) FILTER (WHERE status = 'fetching') AS fetching_count,
                 COUNT(*) FILTER (WHERE status = 'fetched') AS fetched_count,
                 COUNT(*) FILTER (WHERE status = 'committed') AS committed_count,
                 COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
             FROM block_jobs
             WHERE chain_id = $1`,
            [chainId]
        );
        const row = result.rows[0];

        return {
            pending: parsePgInt(row.pending_count),
            fetching: parsePgInt(row.fetching_count),
            fetched: parsePgInt(row.fetched_count),
            committed: parsePgInt(row.committed_count),
            failed: parsePgInt(row.failed_count),
        };
    }

    async listFailedBlocks(
        chainId: ChainId,
        limit: number,
        transaction?: DbExecutor
    ): Promise<FailedBlockMetrics[]> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<FailedBlockMetricsRow>(
            `SELECT block_number, attempts, error, next_retry_at, updated_at
             FROM block_jobs
             WHERE chain_id = $1
               AND status = 'failed'
             ORDER BY block_number ASC
             LIMIT $2`,
            [chainId, limit]
        );

        return result.rows.map((row) => ({
            block: parsePgInt(row.block_number),
            attempts: row.attempts,
            error: row.error,
            nextRetryAt: row.next_retry_at === null ? null : parsePgTimestamp(row.next_retry_at),
            updatedAt: parsePgTimestamp(row.updated_at),
        }));
    }

    async retryFailed(
        chainId: ChainId,
        fromBlock: BlockNumber,
        toBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        if (fromBlock > toBlock) {
            return 0;
        }

        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE block_jobs
             SET attempts = 0,
                 claimed_by = NULL,
                 claimed_at = NULL,
                 next_retry_at = NOW(),
                 updated_at = NOW()
             WHERE chain_id = $1
               AND block_number BETWEEN $2 AND $3
               AND status = 'failed'`,
            [chainId, fromBlock, toBlock]
        );

        return updated.rowCount ?? 0;
    }

    async deleteAtOrBeforeBlockNumber(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM block_jobs WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlockNumber(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM block_jobs WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    private mapJob(row: BlockJobRow): BlockJob {
        return {
            chainId: row.chain_id,
            blockNumber: parsePgInt(row.block_number),
            status: row.status,
            attempts: row.attempts,
            nextRetryAt: row.next_retry_at === null ? null : parsePgTimestamp(row.next_retry_at),
            error: row.error,
            claimedAt: row.claimed_at === null ? null : parsePgTimestamp(row.claimed_at),
            updatedAt: parsePgTimestamp(row.updated_at),
        };
    }
}
