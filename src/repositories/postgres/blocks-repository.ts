import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { BlocksRepository } from "../../interfaces/repositories.js";
import type { BlockDataProgress } from "../../interfaces/metrics.js";
import type { PipelineBlock } from "../../interfaces/pipeline.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface BlockRow {
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    parent_hash: string;
    block_timestamp: bigint | number | string;
    fetched_at: Date | string;
}

interface BlockDataProgressRow {
    max_fetched_block: bigint | number | string | null;
    max_fetched_block_timestamp: bigint | number | string | null;
    last_fetched_at: Date | string | null;
}

export class PostgresBlocksRepository implements BlocksRepository {
    constructor(
        private readonly pool: DbExecutor,
    ) {
    }

    async get(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<PipelineBlock | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockRow>(
            `SELECT chain_id, block_number, block_hash, parent_hash, block_timestamp, fetched_at
             FROM blocks
             WHERE chain_id = $1
               AND block_number = $2`,
            [chainId, blockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return mapBlock(result.rows[0]);
    }

    async getProgress(chainId: ChainId, transaction?: DbExecutor): Promise<BlockDataProgress | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<BlockDataProgressRow>(
            `SELECT
                 latest.block_number AS max_fetched_block,
                 latest.block_timestamp AS max_fetched_block_timestamp,
                 (SELECT MAX(fetched_at) FROM blocks WHERE chain_id = $1) AS last_fetched_at
             FROM (
                 SELECT block_number, block_timestamp
                 FROM blocks
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
            throw new Error(`Fetched block progress block is missing for chain ${String(chainId)}`);
        }
        if (row.max_fetched_block_timestamp === null) {
            throw new Error(
                `Fetched block timestamp is missing for chain ${String(chainId)} `
                + `block ${String(row.max_fetched_block)}`
            );
        }
        if (row.last_fetched_at === null) {
            throw new Error(`Fetched block time is missing for chain ${String(chainId)}`);
        }

        return {
            block: parsePgInt(row.max_fetched_block),
            blockTimestamp: parsePgInt(row.max_fetched_block_timestamp),
            updatedAt: parsePgTimestamp(row.last_fetched_at),
        };
    }

    async insert(block: PipelineBlock, transaction?: DbExecutor): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO blocks
                 (chain_id, block_number, block_hash, parent_hash, block_timestamp, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                block.chainId,
                block.blockNumber,
                block.blockHash,
                block.parentHash,
                block.blockTimestamp,
                block.fetchedAt,
            ]
        );
    }

    async deleteAtOrBeforeBlockNumber(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM blocks WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteByBlockNumber(
        chainId: ChainId,
        blockNumber: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM blocks WHERE chain_id = $1 AND block_number = $2`,
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
            `DELETE FROM blocks WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}

function mapBlock(row: BlockRow): PipelineBlock {
    return {
        chainId: row.chain_id,
        blockNumber: parsePgInt(row.block_number),
        blockHash: asHash32(row.block_hash),
        parentHash: asHash32(row.parent_hash),
        blockTimestamp: parsePgInt(row.block_timestamp),
        fetchedAt: parsePgTimestamp(row.fetched_at),
    };
}
