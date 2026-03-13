import { parsePgBigint, parsePgInt } from "./pg-parsers.js";
import type { EventStreamStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { CanonicalEvent } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface CanonicalEventRow {
    seq: bigint | number | string;
    chain_id: number;
    block_number: bigint | number | string;
    tx_index: number;
    log_index: number;
    payload: unknown;
}

export class PostgresEventStreamStore implements EventStreamStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async readFromSeq(chainId: ChainId, fromSeqExclusive: bigint, limit: number): Promise<CanonicalEvent[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const result = await this.pool.query<CanonicalEventRow>(
            `SELECT seq, chain_id, block_number, tx_index, log_index, payload
             FROM canonical_events
             WHERE chain_id = $1
               AND seq > $2
             ORDER BY seq ASC
                 LIMIT $3`,
            [chainId, fromSeqExclusive, safeLimit]
        );

        return result.rows.map((row) => ({
            seq: parsePgBigint(row.seq),
            chainId: row.chain_id,
            blockNumber: parsePgInt(row.block_number),
            txIndex: row.tx_index,
            logIndex: row.log_index,
            payload: row.payload,
        }));
    }
}
