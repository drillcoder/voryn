import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgBigint, parsePgInt } from "../../postgres/pg-parsers.js";
import type { CanonicalTransactionsRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId, HashHex } from "../../types/chain.js";
import type { ChainTransaction } from "../../interfaces/chain.js";
import type { CanonicalTransaction } from "../../interfaces/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

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

const MAX_SQL_PARAMS_PER_QUERY = 60000;

export class PostgresCanonicalTransactionsRepository implements CanonicalTransactionsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async readFromSeq(
        chainId: ChainId,
        fromSeqExclusive: bigint,
        limit: number,
        transaction?: DbExecutor
    ): Promise<CanonicalTransaction[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const executor = transaction ?? this.pool;
        const result = await executor.query<CanonicalTransactionRow>(
            `SELECT seq, chain_id, block_number, block_hash, transaction_index, transaction_hash,
                    from_address, to_address, value, data, raw
             FROM canonical_transactions
             WHERE chain_id = $1
               AND seq > $2
             ORDER BY seq
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

    async maxSeq(chainId: ChainId, transaction?: DbExecutor): Promise<bigint> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<{ max_seq: bigint | number | string }>(
            `SELECT COALESCE(MAX(seq), 0) AS max_seq
             FROM canonical_transactions
             WHERE chain_id = $1`,
            [chainId]
        );

        return parsePgBigint(result.rows[0].max_seq);
    }

    async insertMany(
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        transactions: ChainTransaction[],
        transaction?: DbExecutor
    ): Promise<void> {
        if (transactions.length === 0) {
            return;
        }

        const executor = transaction ?? this.pool;
        const columnsPerRow = buildTransactionInsertRowParams(
            chainId,
            blockNumber,
            blockHash,
            transactions[0]
        ).length;
        const maxRowsPerBatch = Math.max(1, Math.floor(MAX_SQL_PARAMS_PER_QUERY / columnsPerRow));

        for (let from = 0; from < transactions.length; from += maxRowsPerBatch) {
            const batch = transactions.slice(from, from + maxRowsPerBatch);
            const params = batch.flatMap(
                (entry) => buildTransactionInsertRowParams(chainId, blockNumber, blockHash, entry)
            );
            const placeholders = buildValuesPlaceholders(batch.length, columnsPerRow);

            await executor.query(
                `INSERT INTO canonical_transactions
                    (
                        chain_id,
                        block_number,
                        block_hash,
                        transaction_index,
                        transaction_hash,
                        from_address,
                        to_address,
                        value,
                        data,
                        raw
                    )
                 VALUES ${placeholders}
                 ON CONFLICT (chain_id, block_number, transaction_index) DO NOTHING`,
                params
            );
        }
    }

    async deleteUpToBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_transactions WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_transactions WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

function buildTransactionInsertRowParams(
    chainId: ChainId,
    blockNumber: BlockNumber,
    blockHash: HashHex,
    tx: ChainTransaction
): readonly unknown[] {
    return [
        chainId,
        blockNumber,
        blockHash,
        tx.index,
        tx.hash,
        tx.from,
        tx.to,
        tx.value,
        tx.data,
        tx.raw,
    ];
}

function buildValuesPlaceholders(rowCount: number, columnsPerRow: number): string {
    let paramIndex = 1;

    return Array.from({ length: rowCount }, () => (
        `(${Array.from({ length: columnsPerRow }, () => `$${String(paramIndex++)}`).join(", ")})`
    )).join(", ");
}
