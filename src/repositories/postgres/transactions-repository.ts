import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgInt } from "../../postgres/pg-parsers.js";
import type { TransactionsRepository } from "../../interfaces/repositories.js";
import type { PipelineTransaction } from "../../interfaces/pipeline.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface TransactionRow {
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    transaction_index: number;
    transaction_hash: string;
    from_address: string;
    to_address: string | null;
    value: string;
    data: string;
}

const MAX_SQL_PARAMS_PER_QUERY = 60000;

export class PostgresTransactionsRepository implements TransactionsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async listAfterPosition(
        chainId: ChainId,
        maxBlockNumber: BlockNumber,
        afterBlockNumber: BlockNumber,
        afterTransactionIndex: number,
        limit: number,
        transaction?: DbExecutor
    ): Promise<PipelineTransaction[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const executor = transaction ?? this.pool;
        const result = await executor.query<TransactionRow>(
            `SELECT
                 chain_id,
                 block_number,
                 block_hash,
                 transaction_index,
                 transaction_hash,
                 from_address,
                 to_address,
                 value,
                 data
             FROM transactions
             WHERE chain_id = $1
               AND block_number <= $2
               AND (block_number, transaction_index) > ($3, $4)
             ORDER BY block_number, transaction_index
             LIMIT $5`,
            [chainId, maxBlockNumber, afterBlockNumber, afterTransactionIndex, safeLimit]
        );

        return result.rows.map(mapTransaction);
    }

    async insertMany(transactions: PipelineTransaction[], transaction?: DbExecutor): Promise<void> {
        if (transactions.length === 0) {
            return;
        }

        const executor = transaction ?? this.pool;
        const columnsPerRow = buildTransactionInsertRowParams(transactions[0]).length;
        const maxRowsPerBatch = Math.max(1, Math.floor(MAX_SQL_PARAMS_PER_QUERY / columnsPerRow));

        for (let from = 0; from < transactions.length; from += maxRowsPerBatch) {
            const batch = transactions.slice(from, from + maxRowsPerBatch);
            const params = batch.flatMap(buildTransactionInsertRowParams);
            const placeholders = buildValuesPlaceholders(batch.length, columnsPerRow);

            await executor.query(
                `INSERT INTO transactions
                    (
                        chain_id,
                        block_number,
                        block_hash,
                        transaction_index,
                        transaction_hash,
                        from_address,
                        to_address,
                        value,
                        data
                    )
                 VALUES ${placeholders}`,
                params
            );
        }
    }

    async deleteAtOrBeforeBlockNumber(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM transactions WHERE chain_id = $1 AND block_number <= $2`,
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
            `DELETE FROM transactions WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

function mapTransaction(row: TransactionRow): PipelineTransaction {
    return {
        chainId: row.chain_id,
        blockNumber: parsePgInt(row.block_number),
        blockHash: asHash32(row.block_hash),
        index: row.transaction_index,
        hash: asHash32(row.transaction_hash),
        from: asAddress(row.from_address),
        to: row.to_address === null ? null : asAddress(row.to_address),
        value: row.value,
        data: asHexData(row.data),
    };
}

function buildTransactionInsertRowParams(tx: PipelineTransaction): readonly unknown[] {
    return [
        tx.chainId,
        tx.blockNumber,
        tx.blockHash,
        tx.index,
        tx.hash,
        tx.from,
        tx.to,
        tx.value,
        tx.data,
    ];
}

function buildValuesPlaceholders(rowCount: number, columnsPerRow: number): string {
    let paramIndex = 1;

    return Array.from({ length: rowCount }, () => (
        `(${Array.from({ length: columnsPerRow }, () => `$${String(paramIndex++)}`).join(", ")})`
    )).join(", ");
}
