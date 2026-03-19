import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgBigint, parsePgInt } from "./pg-parsers.js";
import type { EventStreamStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { CanonicalEvent } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface CanonicalEventRow {
    seq: bigint | number | string;
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    transaction_index: number;
    transaction_hash: string;
    log_index: number;
    address: string;
    topics: unknown;
    data: string;
    raw: unknown;
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
            `SELECT seq, chain_id, block_number, block_hash, transaction_index, transaction_hash,
                    log_index, address, topics, data, raw
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
            blockHash: asHash32(row.block_hash),
            transactionIndex: row.transaction_index,
            transactionHash: asHash32(row.transaction_hash),
            index: row.log_index,
            address: asAddress(row.address),
            topics: parseTopics(row.topics),
            data: asHexData(row.data),
            raw: row.raw,
        }));
    }
}

const parseTopics = (value: unknown): ReturnType<typeof asHash32>[] => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error("invalid topics: expected array of hashes");
    }

    return value.map((topic) => asHash32(topic));
};
