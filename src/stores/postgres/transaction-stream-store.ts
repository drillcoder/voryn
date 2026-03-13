import { asHash32 } from "../../utils/hex.js";
import { parsePgBigint, parsePgInt } from "./pg-parsers.js";
import type { TransactionStreamStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { CanonicalTransaction } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface CanonicalTransactionRow {
    seq: bigint | number | string;
    chain_id: number;
    block_number: bigint | number | string;
    tx_index: number;
    tx_hash: string;
    payload: unknown;
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
            `SELECT seq, chain_id, block_number, tx_index, tx_hash, payload
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
            txIndex: row.tx_index,
            txHash: asHash32(row.tx_hash),
            payload: row.payload,
        }));
    }
}
