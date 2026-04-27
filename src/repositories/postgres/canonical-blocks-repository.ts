import { asHash32 } from "../../utils/hex.js";
import { parsePgInt } from "../../postgres/pg-parsers.js";
import type { CanonicalBlocksRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { DbExecutor } from "../../interfaces/db.js";
import type { ChainBlock } from "../../interfaces/chain.js";

interface CanonicalBlockRow {
    chain_id: number;
    block_number: bigint | number | string;
    block_hash: string;
    parent_hash: string;
    block_timestamp: bigint | number | string;
    raw: unknown;
}

export class PostgresCanonicalBlocksRepository implements CanonicalBlocksRepository {
    constructor(private readonly pool: DbExecutor) {
    }

    async insert(block: ChainBlock, transaction?: DbExecutor): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO canonical_blocks (chain_id, block_number, block_hash, parent_hash, block_timestamp, raw)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (chain_id, block_number) DO NOTHING`,
            [block.chainId, block.number, block.hash, block.parentHash, block.timestamp, block.raw]
        );
    }

    async get(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<ChainBlock | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<CanonicalBlockRow>(
            `SELECT chain_id, block_number, block_hash, parent_hash, block_timestamp, raw
             FROM canonical_blocks
             WHERE chain_id = $1
               AND block_number = $2`,
            [chainId, blockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: result.rows[0].chain_id,
            number: parsePgInt(result.rows[0].block_number),
            hash: asHash32(result.rows[0].block_hash),
            parentHash: asHash32(result.rows[0].parent_hash),
            timestamp: parsePgInt(result.rows[0].block_timestamp),
            raw: result.rows[0].raw,
        };
    }

    async deleteUpToBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_blocks WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }

    async deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_blocks WHERE chain_id = $1 AND block_number > $2`,
            [chainId, blockNumber]
        );

        return deleted.rowCount ?? 0;
    }
}
