import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { RawBlocksRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { RawBlockProgress } from "../../interfaces/metrics.js";
import type { FetchedBlock } from "../../interfaces/chain.js";
import type { RawBlock } from "../../interfaces/pipeline.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface RawBlockRow {
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    parent_hash: string;
    payload: unknown;
    fetched_at: Date | string;
}

interface RawBlockProgressRow {
    max_fetched_block: bigint | number | string | null;
    max_fetched_block_timestamp: bigint | number | string | null;
    last_fetched_at: Date | string | null;
}

export class PostgresRawBlocksRepository implements RawBlocksRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async save(block: RawBlock, transaction?: DbExecutor): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO raw_blocks
             (chain_id, block_number, block_hash, parent_hash, payload, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (chain_id, block_number) DO UPDATE
             SET block_hash = EXCLUDED.block_hash,
                 parent_hash = EXCLUDED.parent_hash,
                 payload = EXCLUDED.payload,
                 fetched_at = EXCLUDED.fetched_at`,
            [
                block.chainId,
                block.blockNumber,
                block.blockHash,
                block.parentHash,
                block.payload,
                block.fetchedAt,
            ]
        );
    }

    async get(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<RawBlock | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<RawBlockRow>(
            `SELECT chain_id, block_number, block_hash, parent_hash, payload, fetched_at
             FROM raw_blocks
             WHERE chain_id = $1
               AND block_number = $2`,
            [chainId, blockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: result.rows[0].chain_id,
            blockNumber: parsePgInt(result.rows[0].block_number),
            blockHash: asHash32(result.rows[0].block_hash),
            parentHash: asHash32(result.rows[0].parent_hash),
            payload: result.rows[0].payload as FetchedBlock,
            fetchedAt: parsePgTimestamp(result.rows[0].fetched_at),
        };
    }

    async getProgress(chainId: ChainId, transaction?: DbExecutor): Promise<RawBlockProgress | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<RawBlockProgressRow>(
            `SELECT
                 latest.block_number AS max_fetched_block,
                 (latest.payload->'block'->>'timestamp')::BIGINT AS max_fetched_block_timestamp,
                 (SELECT MAX(fetched_at) FROM raw_blocks WHERE chain_id = $1) AS last_fetched_at
             FROM (
                 SELECT block_number, payload
                 FROM raw_blocks
                 WHERE chain_id = $1
                 ORDER BY block_number DESC
                 LIMIT 1
             ) latest`,
            [chainId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        if (row.max_fetched_block === null) {
            throw new Error(`Raw block progress block is missing for chain ${String(chainId)}`);
        }
        if (row.max_fetched_block_timestamp === null) {
            throw new Error(
                `Raw block timestamp is missing for chain ${String(chainId)} block ${String(row.max_fetched_block)}`
            );
        }
        if (row.last_fetched_at === null) {
            throw new Error(`Raw block fetch time is missing for chain ${String(chainId)}`);
        }

        return {
            block: parsePgInt(row.max_fetched_block),
            blockTimestamp: parsePgInt(row.max_fetched_block_timestamp),
            updatedAt: parsePgTimestamp(row.last_fetched_at),
        };
    }

    async deleteUpToBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM raw_blocks WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM raw_blocks WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}
