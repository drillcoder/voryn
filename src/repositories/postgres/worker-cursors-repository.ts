import { parsePgBigint, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { WorkerCursorsRepository } from "../../interfaces/repositories.js";
import type { ChainId } from "../../types/chain.js";
import type { StreamType } from "../../types/pipeline.js";
import type { WorkerCursor } from "../../interfaces/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface WorkerCursorRow {
    worker_name: string;
    chain_id: number;
    stream_type: StreamType;
    last_seq: bigint | number | string;
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
            `SELECT worker_name, chain_id, stream_type, last_seq, updated_at
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
            lastSeq: parsePgBigint(result.rows[0].last_seq),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }

    async insert(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        lastSeq: bigint,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO worker_cursors (worker_name, chain_id, stream_type, last_seq)
             VALUES ($1, $2, $3, $4)`,
            [workerName, chainId, streamType, lastSeq]
        );
    }

    async advance(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        seq: bigint,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE worker_cursors
             SET last_seq   = GREATEST(last_seq, $4),
                 updated_at = NOW()
             WHERE worker_name = $1
               AND chain_id = $2
               AND stream_type = $3`,
            [workerName, chainId, streamType, seq]
        );

        if ((updated.rowCount ?? 0) > 0) {
            return;
        }

        throw new Error(
            `Worker cursor is missing for worker "${workerName}", ` +
            `chain ${String(chainId)}, stream ${streamType}. ` +
            "Call insert() before advance()"
        );
    }
}
