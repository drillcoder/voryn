import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgBigint, parsePgInt } from "./pg-parsers.js";
import type { TransactionStreamStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { CanonicalTransaction } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface CanonicalTransactionRow {
    seq: bigint | number | string;
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    transaction_index: number;
    transaction_hash: string;
    from_address: string;
    to_address: string | null;
    value: string;
    data: string;
    raw: unknown;
}

export class PostgresTransactionStreamStore implements TransactionStreamStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async readFromSeq(chainId: ChainId, fromSeqExclusive: bigint, limit: number): Promise<CanonicalTransaction[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const result = await this.pool.query<CanonicalTransactionRow>(
            `SELECT seq, chain_id, block_number, block_hash, transaction_index, transaction_hash,
                    from_address, to_address, value, data, raw
             FROM canonical_transactions
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
            index: row.transaction_index,
            hash: asHash32(row.transaction_hash),
            from: asAddress(row.from_address),
            to: row.to_address === null ? null : asAddress(row.to_address),
            value: row.value,
            data: asHexData(row.data),
            raw: row.raw,
        }));
    }
}
