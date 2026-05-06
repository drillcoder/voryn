import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { BlockJobsRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { BlockJobMetrics, BlockJobStatusCounts } from "../../interfaces/metrics.js";
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
    oldest_pending_block: bigint | number | string | null;
    oldest_fetching_block: bigint | number | string | null;
    oldest_fetched_block: bigint | number | string | null;
    oldest_failed_block: bigint | number | string | null;
    oldest_fetching_claimed_at: Date | string | null;
}

export class PostgresBlockJobsRepository implements BlockJobsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
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
        workerId: string,
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
            [chainId, workerId, staleClaimedBefore]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: result.rows[0].chain_id,
            blockNumber: parsePgInt(result.rows[0].block_number),
            status: result.rows[0].status,
            attempts: result.rows[0].attempts,
            nextRetryAt: result.rows[0].next_retry_at === null ? null : parsePgTimestamp(result.rows[0].next_retry_at),
            error: result.rows[0].error,
            claimedAt: result.rows[0].claimed_at === null ? null : parsePgTimestamp(result.rows[0].claimed_at),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }

    async markFetched(
        chainId: ChainId,
        blockNumber: BlockNumber,
        workerId: string,
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
            [chainId, blockNumber, workerId]
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
        workerId: string,
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
            [chainId, blockNumber, workerId, error, nextRetryAt]
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

    async getMetrics(chainId: ChainId, transaction?: DbExecutor): Promise<BlockJobMetrics> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockJobMetricsRow>(
            `SELECT
                 COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
                 COUNT(*) FILTER (WHERE status = 'fetching') AS fetching_count,
                 COUNT(*) FILTER (WHERE status = 'fetched') AS fetched_count,
                 COUNT(*) FILTER (WHERE status = 'committed') AS committed_count,
                 COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
                 MIN(block_number) FILTER (WHERE status = 'pending') AS oldest_pending_block,
                 MIN(block_number) FILTER (WHERE status = 'fetching') AS oldest_fetching_block,
                 MIN(block_number) FILTER (WHERE status = 'fetched') AS oldest_fetched_block,
                 MIN(block_number) FILTER (WHERE status = 'failed') AS oldest_failed_block,
                 MIN(claimed_at) FILTER (WHERE status = 'fetching') AS oldest_fetching_claimed_at
             FROM block_jobs
             WHERE chain_id = $1`,
            [chainId]
        );
        const row = result.rows[0];
        const counts: BlockJobStatusCounts = {
            pending: parsePgInt(row.pending_count),
            fetching: parsePgInt(row.fetching_count),
            fetched: parsePgInt(row.fetched_count),
            committed: parsePgInt(row.committed_count),
            failed: parsePgInt(row.failed_count),
        };

        return {
            counts,
            oldestPendingBlock: parseNullablePgInt(row.oldest_pending_block),
            oldestFetchingBlock: parseNullablePgInt(row.oldest_fetching_block),
            oldestFetchedBlock: parseNullablePgInt(row.oldest_fetched_block),
            oldestFailedBlock: parseNullablePgInt(row.oldest_failed_block),
            oldestFetchingClaimedAt: row.oldest_fetching_claimed_at === null
                ? null
                : parsePgTimestamp(row.oldest_fetching_claimed_at),
        };
    }

    async deleteUpToBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM block_jobs WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM block_jobs WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

function parseNullablePgInt(value: bigint | number | string | null): number | null {
    return value === null ? null : parsePgInt(value);
}
