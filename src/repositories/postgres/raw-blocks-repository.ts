import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { RawBlocksRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
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

    async deleteUpToBlock(
        chainId: ChainId,
        blockNumberInclusive: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM raw_blocks WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumberInclusive]
        );

        return deleted.rowCount ?? 0;
    }
}
