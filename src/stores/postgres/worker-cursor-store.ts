import { parsePgBigint, parsePgTimestamp } from "./pg-parsers.js";
import type { WorkerCursorStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { StreamType, WorkerCursor } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface WorkerCursorRow {
    worker_name: string;
    chain_id: number;
    stream_type: StreamType;
    last_seq: bigint | number | string;
    updated_at: Date | string;
}

export class PostgresWorkerCursorStore implements WorkerCursorStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async get(workerName: string, chainId: ChainId, streamType: StreamType): Promise<WorkerCursor> {
        const current = await this.readCursor(workerName, chainId, streamType);
        if (current) {
            return current;
        }

        const currentSeq = await this.readCurrentSeq(chainId, streamType);
        await this.pool.query(
            `INSERT INTO worker_cursors (worker_name, chain_id, stream_type, last_seq)
             VALUES ($1, $2, $3, $4) ON CONFLICT (worker_name, chain_id, stream_type) DO NOTHING`,
            [workerName, chainId, streamType, currentSeq]
        );

        const created = await this.readCursor(workerName, chainId, streamType);
        if (!created) {
            throw new Error(
                `Failed to create worker cursor for worker "${workerName}", chain ${String(chainId)}, stream ${streamType}`
            );
        }

        return created;
    }

    async advance(workerName: string, chainId: ChainId, streamType: StreamType, seq: bigint): Promise<void> {
        const updated = await this.pool.query(
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
            `Worker cursor is missing for worker "${workerName}", chain ${String(chainId)}, stream ${streamType}. Call get() to bootstrap first`
        );
    }

    private async readCurrentSeq(chainId: ChainId, streamType: StreamType): Promise<bigint> {
        const query = streamType === "event"
            ? `SELECT COALESCE(MAX(seq), 0) AS current_seq FROM canonical_events WHERE chain_id = $1`
            : `SELECT COALESCE(MAX(seq), 0) AS current_seq FROM canonical_transactions WHERE chain_id = $1`;

        const result = await this.pool.query<{ current_seq: bigint | number | string }>(query, [chainId]);
        return parsePgBigint(result.rows[0].current_seq);
    }

    private async readCursor(workerName: string, chainId: ChainId, streamType: StreamType): Promise<WorkerCursor | null> {
        const result = await this.pool.query<WorkerCursorRow>(
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
}
