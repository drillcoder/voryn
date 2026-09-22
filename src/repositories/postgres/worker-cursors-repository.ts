import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { WorkerCursorsRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { StreamType } from "../../types/pipeline.js";
import type { WorkerCursor, WorkerCursorPosition } from "../../interfaces/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface WorkerCursorRow {
    worker_name: string;
    chain_id: number;
    stream_type: StreamType;
    last_block_number: bigint | number | string;
    last_transaction_index: number;
    last_log_index: number;
    reorg_version: bigint | number | string;
    updated_at: Date | string;
}

export class PostgresWorkerCursorsRepository implements WorkerCursorsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async get(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        transaction?: DbExecutor
    ): Promise<WorkerCursor | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<WorkerCursorRow>(
            `SELECT
                 worker_name,
                 chain_id,
                 stream_type,
                 last_block_number,
                 last_transaction_index,
                 last_log_index,
                 reorg_version,
                 updated_at
             FROM worker_cursors
             WHERE worker_name = $1
               AND chain_id = $2
               AND stream_type = $3`,
            [workerName, chainId, streamType]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            workerName: result.rows[0].worker_name,
            chainId: result.rows[0].chain_id,
            streamType: result.rows[0].stream_type,
            position: {
                lastBlockNumber: parsePgInt(result.rows[0].last_block_number),
                lastTransactionIndex: result.rows[0].last_transaction_index,
                lastLogIndex: result.rows[0].last_log_index,
            },
            reorgVersion: parsePgInt(result.rows[0].reorg_version),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }

    async listByChain(chainId: ChainId, transaction?: DbExecutor): Promise<WorkerCursor[]> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<WorkerCursorRow>(
            `SELECT
                 worker_name,
                 chain_id,
                 stream_type,
                 last_block_number,
                 last_transaction_index,
                 last_log_index,
                 reorg_version,
                 updated_at
             FROM worker_cursors
             WHERE chain_id = $1
             ORDER BY worker_name, stream_type`,
            [chainId]
        );

        return result.rows.map((row) => ({
            workerName: row.worker_name,
            chainId: row.chain_id,
            streamType: row.stream_type,
            position: {
                lastBlockNumber: parsePgInt(row.last_block_number),
                lastTransactionIndex: row.last_transaction_index,
                lastLogIndex: row.last_log_index,
            },
            reorgVersion: parsePgInt(row.reorg_version),
            updatedAt: parsePgTimestamp(row.updated_at),
        }));
    }

    async insert(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        position: WorkerCursorPosition,
        reorgVersion: number,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO worker_cursors
                 (worker_name, chain_id, stream_type, last_block_number, last_transaction_index, last_log_index,
                  reorg_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                workerName,
                chainId,
                streamType,
                position.lastBlockNumber,
                position.lastTransactionIndex,
                position.lastLogIndex,
                reorgVersion,
            ]
        );
    }

    async advanceIfVersion(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        position: WorkerCursorPosition,
        expectedReorgVersion: number,
        transaction?: DbExecutor
    ): Promise<boolean> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE worker_cursors
             SET last_block_number = $4,
                 last_transaction_index = $5,
                 last_log_index = $6,
                 updated_at = NOW()
             WHERE worker_name = $1
               AND chain_id = $2
               AND stream_type = $3
               AND reorg_version = $7`,
            [
                workerName,
                chainId,
                streamType,
                position.lastBlockNumber,
                position.lastTransactionIndex,
                position.lastLogIndex,
                expectedReorgVersion,
            ]
        );

        if ((updated.rowCount ?? 0) > 0) {
            return true;
        }

        const current = await this.get(workerName, chainId, streamType, transaction);
        if (current === null) {
            throw new Error(
                `Worker cursor is missing for worker "${workerName}", ` +
                `chain ${String(chainId)}, stream ${streamType}. ` +
                "Call insert() before advanceIfVersion()"
            );
        }

        return false;
    }

    async rewindForReorg(
        chainId: ChainId,
        rollbackFromBlock: BlockNumber,
        reorgVersion: number,
        transaction: DbExecutor
    ): Promise<number> {
        const updated = await transaction.query<{ rewound: boolean }>(
            `UPDATE worker_cursors
             SET last_block_number = CASE
                     WHEN last_block_number >= $2 THEN $2
                     ELSE last_block_number
                 END,
                 last_transaction_index = CASE
                     WHEN last_block_number >= $2 THEN -1
                     ELSE last_transaction_index
                 END,
                 last_log_index = CASE
                     WHEN last_block_number >= $2 THEN -1
                     ELSE last_log_index
                 END,
                 reorg_version = $3,
                 updated_at = NOW()
             WHERE chain_id = $1
             RETURNING last_block_number = $2 AS rewound`,
            [chainId, rollbackFromBlock, reorgVersion]
        );

        return updated.rows.filter((row) => row.rewound).length;
    }
}
