import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "./pg-parsers.js";
import type { RawBlockStore } from "../../interfaces/stores.js";
import type { BlockNumber, ChainId, FetchedBlock } from "../../types/chain.js";
import type { RawBlockEnvelope } from "../../types/pipeline.js";
import type { PgQueryExecutor } from "./client.js";

interface RawBlockRow {
    chain_id: bigint | number | string;
    block_number: bigint | number | string;
    block_hash: string;
    parent_hash: string;
    payload: unknown;
    fetched_at: Date | string;
}

export class PostgresRawBlockStore implements RawBlockStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async save(block: RawBlockEnvelope): Promise<void> {
        await this.pool.query(
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

    async get(chainId: ChainId, blockNumber: BlockNumber): Promise<RawBlockEnvelope | null> {
        const result = await this.pool.query<RawBlockRow>(
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
            chainId: parsePgInt(result.rows[0].chain_id),
            blockNumber: parsePgInt(result.rows[0].block_number),
            blockHash: asHash32(result.rows[0].block_hash),
            parentHash: asHash32(result.rows[0].parent_hash),
            payload: result.rows[0].payload as FetchedBlock,
            fetchedAt: parsePgTimestamp(result.rows[0].fetched_at),
        };
    }
}
