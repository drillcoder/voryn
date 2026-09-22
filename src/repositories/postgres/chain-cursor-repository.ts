import { asHash32 } from "../../utils/hex.js";
import { parsePgInt, parsePgTimestamp } from "../../postgres/pg-parsers.js";
import type { BlockNumber, ChainId, HashHex } from "../../types/chain.js";
import type { ChainCursor } from "../../interfaces/pipeline.js";
import type { ChainCursorRepository } from "../../interfaces/repositories.js";
import type { DbExecutor } from "../../interfaces/db.js";

interface ChainCursorRow {
    chain_id: number;
    last_enqueued_block: bigint | number | string;
    last_committed_block: bigint | number | string;
    last_committed_hash: string;
    reorg_version: bigint | number | string;
    updated_at: Date | string;
}

export class PostgresChainCursorRepository implements ChainCursorRepository {
    constructor(private readonly pool: DbExecutor) {
    }

    async get(chainId: ChainId, transaction?: DbExecutor): Promise<ChainCursor | null> {
        const executor = transaction ?? this.pool;
        const result = await executor.query<ChainCursorRow>(
            `SELECT chain_id,
                    last_enqueued_block,
                    last_committed_block,
                    last_committed_hash,
                    reorg_version,
                    updated_at
             FROM chain_cursor
             WHERE chain_id = $1`,
            [chainId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: result.rows[0].chain_id,
            lastEnqueuedBlock: parsePgInt(result.rows[0].last_enqueued_block),
            lastCommittedBlock: parsePgInt(result.rows[0].last_committed_block),
            lastCommittedHash: asHash32(result.rows[0].last_committed_hash),
            reorgVersion: parsePgInt(result.rows[0].reorg_version),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }

    async getForUpdate(chainId: ChainId, transaction: DbExecutor): Promise<ChainCursor | null> {
        const result = await transaction.query<ChainCursorRow>(
            `SELECT chain_id,
                    last_enqueued_block,
                    last_committed_block,
                    last_committed_hash,
                    reorg_version,
                    updated_at
             FROM chain_cursor
             WHERE chain_id = $1
             FOR UPDATE`,
            [chainId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            chainId: result.rows[0].chain_id,
            lastEnqueuedBlock: parsePgInt(result.rows[0].last_enqueued_block),
            lastCommittedBlock: parsePgInt(result.rows[0].last_committed_block),
            lastCommittedHash: asHash32(result.rows[0].last_committed_hash),
            reorgVersion: parsePgInt(result.rows[0].reorg_version),
            updatedAt: parsePgTimestamp(result.rows[0].updated_at),
        };
    }

    async insert(cursor: Omit<ChainCursor, "updatedAt">, transaction?: DbExecutor): Promise<void> {
        const executor = transaction ?? this.pool;
        await executor.query(
            `INSERT INTO chain_cursor
             (chain_id, last_enqueued_block, last_committed_block, last_committed_hash, reorg_version)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (chain_id) DO NOTHING`,
            [
                cursor.chainId,
                cursor.lastEnqueuedBlock,
                cursor.lastCommittedBlock,
                cursor.lastCommittedHash,
                cursor.reorgVersion,
            ]
        );
    }

    async setPositionsAndIncrementReorgVersion(
        chainId: ChainId,
        lastCommittedBlock: BlockNumber,
        lastCommittedHash: HashHex,
        lastEnqueuedBlock: BlockNumber,
        transaction: DbExecutor
    ): Promise<number> {
        const updated = await transaction.query<{ reorg_version: bigint | number | string }>(
            `UPDATE chain_cursor
             SET last_committed_block = $2,
                 last_committed_hash = $3,
                 last_enqueued_block = $4,
                 reorg_version = reorg_version + 1,
                 updated_at = NOW()
             WHERE chain_id = $1
             RETURNING reorg_version`,
            [chainId, lastCommittedBlock, lastCommittedHash, lastEnqueuedBlock]
        );

        if ((updated.rowCount ?? 0) !== 1 || updated.rows.length !== 1) {
            throw new Error(`Chain cursor for chain ${String(chainId)} not found`);
        }

        return parsePgInt(updated.rows[0].reorg_version);
    }

    async setLastEnqueued(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<void> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE chain_cursor
             SET last_enqueued_block = GREATEST(last_enqueued_block, $2),
                 updated_at = NOW()
             WHERE chain_id = $1`,
            [chainId, blockNumber]
        );

        if ((updated.rowCount ?? 0) === 0) {
            throw new Error(`Chain cursor for chain ${String(chainId)} not found`);
        }
    }

    async setPositions(
        chainId: ChainId,
        lastCommittedBlock: BlockNumber,
        lastCommittedHash: HashHex,
        lastEnqueuedBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE chain_cursor
             SET last_committed_block = $2,
                 last_committed_hash = $3,
                 last_enqueued_block = $4,
                 updated_at = NOW()
             WHERE chain_id = $1`,
            [chainId, lastCommittedBlock, lastCommittedHash, lastEnqueuedBlock]
        );

        if ((updated.rowCount ?? 0) === 0) {
            throw new Error(`Chain cursor for chain ${String(chainId)} not found`);
        }
    }

    async advanceLastCommitted(
        chainId: ChainId,
        expectedPreviousBlockNumber: BlockNumber,
        expectedPreviousHash: HashHex,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        transaction?: DbExecutor
    ): Promise<void> {
        const executor = transaction ?? this.pool;
        const updated = await executor.query(
            `UPDATE chain_cursor
             SET last_committed_block = $4,
                 last_committed_hash = $5,
                 updated_at = NOW()
             WHERE chain_id = $1
               AND last_committed_block = $2
               AND last_committed_hash = $3`,
            [chainId, expectedPreviousBlockNumber, expectedPreviousHash, blockNumber, blockHash]
        );

        if ((updated.rowCount ?? 0) !== 1) {
            throw new Error(
                `Failed to advance chain cursor for chain ${String(chainId)} to block ${String(blockNumber)}`
            );
        }
    }
}
