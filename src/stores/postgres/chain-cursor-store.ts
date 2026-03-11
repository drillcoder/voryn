import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "./pg-parsers.js";
import type { ChainCursor, ChainCursorStore } from "../../interfaces/stores.js";
import type { BlockNumber, ChainId, HashHex } from "../../types/chain.js";
import type { PgQueryExecutor } from "./client.js";

interface ChainCursorRow {
    chain_id: bigint | number | string;
    last_enqueued_block: bigint | number | string;
    last_committed_block: bigint | number | string;
    last_committed_hash: string;
    updated_at: Date | string;
}

export interface ChainCursorBootstrap {
    lastEnqueuedBlock: BlockNumber;
    lastCommittedBlock: BlockNumber;
    lastCommittedHash: HashHex;
}

export type ChainCursorBootstrapper = (chainId: ChainId) => Promise<ChainCursorBootstrap>;

export class PostgresChainCursorStore implements ChainCursorStore {
    constructor(
        private readonly pool: PgQueryExecutor,
        private readonly bootstrap: ChainCursorBootstrapper
    ) {
    }

    async get(chainId: ChainId): Promise<ChainCursor> {
        const current = await this.readCursor(chainId);
        if (current) {
            return current;
        }

        const bootstrap = await this.bootstrap(chainId);
        await this.pool.query(
            `INSERT INTO chain_cursor
             (chain_id, last_enqueued_block, last_committed_block, last_committed_hash)
             VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id) DO NOTHING`,
            [
                chainId,
                bootstrap.lastEnqueuedBlock,
                bootstrap.lastCommittedBlock,
                bootstrap.lastCommittedHash,
            ]
        );

        const created = await this.readCursor(chainId);
        if (!created) {
            throw new Error(`Failed to create chain cursor for chain ${String(chainId)}`);
        }

        return created;
    }

    async setLastEnqueued(chainId: ChainId, blockNumber: BlockNumber): Promise<void> {
        const updated = await this.pool.query(
            `UPDATE chain_cursor
             SET last_enqueued_block = GREATEST(last_enqueued_block, $2),
                 updated_at          = NOW()
             WHERE chain_id = $1`,
            [chainId, blockNumber]
        );

        if ((updated.rowCount ?? 0) > 0) {
            return;
        }

        throw new Error(
            `Chain cursor for chain ${String(chainId)} is missing. Call get() to bootstrap first`
        );
    }

    private async readCursor(chainId: ChainId): Promise<ChainCursor | null> {
        const result = await this.pool.query<ChainCursorRow>(
            `SELECT chain_id,
                    last_enqueued_block,
                    last_committed_block,
                    last_committed_hash,
                    updated_at
             FROM chain_cursor
             WHERE chain_id = $1`,
            [chainId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: parsePgInt(result.rows[0].chain_id),
            lastEnqueuedBlock: parsePgInt(result.rows[0].last_enqueued_block),
            lastCommittedBlock: parsePgInt(result.rows[0].last_committed_block),
            lastCommittedHash: asHash32(result.rows[0].last_committed_hash),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }
}
