import type { CanonicalBlocksRepository } from "../../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../../types/chain.js";
import type { DbExecutor } from "../../interfaces/db.js";
import type { ChainBlock } from "../../interfaces/chain.js";

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

    async deleteUpToBlock(
        chainId: ChainId,
        blockNumberInclusive: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number> {
        const executor = transaction ?? this.pool;
        const deleted = await executor.query(
            `DELETE FROM canonical_blocks WHERE chain_id = $1 AND block_number <= $2`,
            [chainId, blockNumberInclusive]
        );

        return deleted.rowCount ?? 0;
    }
}
