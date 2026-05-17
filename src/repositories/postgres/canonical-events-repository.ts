import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { parsePgBigint, parsePgInt } from "../../postgres/pg-parsers.js";
import type { CanonicalEventsRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId, HashHex } from "../../types/chain.js";
import type { ChainLog } from "../../interfaces/chain.js";
import type { CanonicalEvent } from "../../interfaces/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

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
}

const MAX_SQL_PARAMS_PER_QUERY = 60000;

export class PostgresCanonicalEventsRepository implements CanonicalEventsRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async readFromSeq(
        chainId: ChainId,
        fromSeqExclusive: bigint,
        limit: number,
        transaction?: DbExecutor
    ): Promise<CanonicalEvent[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const executor = transaction ?? this.pool;
        const result = await executor.query<CanonicalEventRow>(
            `SELECT seq, chain_id, block_number, block_hash, transaction_index, transaction_hash,
                    log_index, address, topics, data
             FROM canonical_events
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
            transactionIndex: row.transaction_index,
            transactionHash: asHash32(row.transaction_hash),
            index: row.log_index,
            address: asAddress(row.address),
            topics: parseTopics(row.topics),
            data: asHexData(row.data),
        }));
    }

    async maxSeq(chainId: ChainId, transaction?: DbExecutor): Promise<bigint> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<{ max_seq: bigint | number | string }>(
            `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM canonical_events WHERE chain_id = $1`,
            [chainId]
        );

        return parsePgBigint(result.rows[0].max_seq);
    }

    async insertMany(
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        logs: ChainLog[],
        transaction?: DbExecutor
    ): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        const executor = transaction ?? this.pool;
        const columnsPerRow = buildEventInsertRowParams(chainId, blockNumber, blockHash, logs[0]).length;
        const maxRowsPerBatch = Math.max(1, Math.floor(MAX_SQL_PARAMS_PER_QUERY / columnsPerRow));

        for (let from = 0; from < logs.length; from += maxRowsPerBatch) {
            const batch = logs.slice(from, from + maxRowsPerBatch);
            const params = batch.flatMap((entry) => buildEventInsertRowParams(chainId, blockNumber, blockHash, entry));
            const placeholders = buildValuesPlaceholders(batch.length, columnsPerRow);

            await executor.query(
                `INSERT INTO canonical_events
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
                 VALUES ${placeholders}
                 ON CONFLICT (chain_id, block_number, transaction_index, log_index) DO NOTHING`,
                params
            );
        }
    }

    async deleteUpToBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_events WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_events WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

const parseTopics = (value: unknown): ReturnType<typeof asHash32>[] => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error("invalid topics: expected array of hashes");
    }

    return value.map((topic) => asHash32(topic));
};

function buildEventInsertRowParams(
    chainId: ChainId,
    blockNumber: BlockNumber,
    blockHash: HashHex,
    log: ChainLog
): readonly unknown[] {
    return [
        chainId,
        blockNumber,
        blockHash,
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
