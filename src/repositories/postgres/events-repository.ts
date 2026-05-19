import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgInt } from "../../postgres/pg-parsers.js";
import type { EventsRepository } from "../../interfaces/repositories.js";
import type { PipelineEvent } from "../../interfaces/pipeline.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface EventRow {
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    transaction_index: number;
    transaction_hash: string;
    log_index: number;
    address: string;
    topics: unknown;
    data: string;
}

const MAX_SQL_PARAMS_PER_QUERY = 60000;

export class PostgresEventsRepository implements EventsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async listAfterPosition(
        chainId: ChainId,
        maxBlockNumber: BlockNumber,
        afterBlockNumber: BlockNumber,
        afterTransactionIndex: number,
        afterLogIndex: number,
        limit: number,
        transaction?: DbExecutor
    ): Promise<PipelineEvent[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const executor = transaction ?? this.pool;
        const result = await executor.query<EventRow>(
            `SELECT
                 chain_id,
                 block_number,
                 block_hash,
                 transaction_index,
                 transaction_hash,
                 log_index,
                 address,
                 topics,
                 data
             FROM events
             WHERE chain_id = $1
               AND block_number <= $2
               AND (block_number, transaction_index, log_index) > ($3, $4, $5)
             ORDER BY block_number, transaction_index, log_index
             LIMIT $6`,
            [chainId, maxBlockNumber, afterBlockNumber, afterTransactionIndex, afterLogIndex, safeLimit]
        );

        return result.rows.map(mapEvent);
    }

    async insertMany(events: PipelineEvent[], transaction?: DbExecutor): Promise<void> {
        if (events.length === 0) {
            return;
        }

        const executor = transaction ?? this.pool;
        const columnsPerRow = buildEventInsertRowParams(events[0]).length;
        const maxRowsPerBatch = Math.max(1, Math.floor(MAX_SQL_PARAMS_PER_QUERY / columnsPerRow));

        for (let from = 0; from < events.length; from += maxRowsPerBatch) {
            const batch = events.slice(from, from + maxRowsPerBatch);
            const params = batch.flatMap(buildEventInsertRowParams);
            const placeholders = buildValuesPlaceholders(batch.length, columnsPerRow);

            await executor.query(
                `INSERT INTO events
                    (
                        chain_id,
                        block_number,
                        block_hash,
                        transaction_index,
                        transaction_hash,
                        log_index,
                        address,
                        topics,
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
            `DELETE FROM events WHERE chain_id = $1 AND block_number <= $2`,
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
            `DELETE FROM events WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

function mapEvent(row: EventRow): PipelineEvent {
    return {
        chainId: row.chain_id,
        blockNumber: parsePgInt(row.block_number),
        blockHash: asHash32(row.block_hash),
        transactionIndex: row.transaction_index,
        transactionHash: asHash32(row.transaction_hash),
        index: row.log_index,
        address: asAddress(row.address),
        topics: parseTopics(row.topics),
        data: asHexData(row.data),
    };
}

function parseTopics(value: unknown): ReturnType<typeof asHash32>[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error("invalid topics: expected array of hashes");
    }

    return value.map((topic) => asHash32(topic));
}

function buildEventInsertRowParams(log: PipelineEvent): readonly unknown[] {
    return [
        log.chainId,
        log.blockNumber,
        log.blockHash,
        log.transactionIndex,
        log.transactionHash,
        log.index,
        log.address,
        log.topics,
        log.data,
    ];
}

function buildValuesPlaceholders(rowCount: number, columnsPerRow: number): string {
    let paramIndex = 1;

    return Array.from({ length: rowCount }, () => (
        `(${Array.from({ length: columnsPerRow }, () => `$${String(paramIndex++)}`).join(", ")})`
    )).join(", ");
}
