import { parsePgInt } from "./pg-parsers.js";
import type { RetentionPurgeResult, RetentionStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { PgQueryExecutor } from "./client.js";

interface PurgeCountRow {
    deleted_block_jobs_count: bigint | number | string;
    deleted_raw_blocks_count: bigint | number | string;
    deleted_canonical_events_count: bigint | number | string;
    deleted_canonical_transactions_count: bigint | number | string;
    deleted_canonical_blocks_count: bigint | number | string;
}

export class PostgresRetentionStore implements RetentionStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async purge(chainId: ChainId, depthBlocks: number): Promise<RetentionPurgeResult> {
        const result = await this.pool.query<PurgeCountRow>(
            `WITH purge_boundary AS (
                SELECT (last_committed_block - $2::BIGINT) AS purge_to_block
                FROM chain_cursor
                WHERE chain_id = $1
            ),
            deleted_block_jobs AS (
                DELETE FROM block_jobs
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            ),
            deleted_raw_blocks AS (
                DELETE FROM raw_blocks
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            ),
            deleted_canonical_blocks AS (
                DELETE FROM canonical_blocks
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            ),
            deleted_canonical_transactions AS (
                DELETE FROM canonical_transactions
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            ),
            deleted_canonical_events AS (
                DELETE FROM canonical_events
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            )
            SELECT
                (SELECT COUNT(*) FROM deleted_block_jobs) AS deleted_block_jobs_count,
                (SELECT COUNT(*) FROM deleted_raw_blocks) AS deleted_raw_blocks_count,
                (SELECT COUNT(*) FROM deleted_canonical_blocks) AS deleted_canonical_blocks_count,
                (SELECT COUNT(*) FROM deleted_canonical_transactions) AS deleted_canonical_transactions_count,
                (SELECT COUNT(*) FROM deleted_canonical_events) AS deleted_canonical_events_count`,
            [chainId, depthBlocks]
        );

        const row = result.rows[0];

        return {
            deletedBlockJobs: parsePgInt(row.deleted_block_jobs_count),
            deletedRawBlocks: parsePgInt(row.deleted_raw_blocks_count),
            deletedCanonicalBlocks: parsePgInt(row.deleted_canonical_blocks_count),
            deletedCanonicalTransactions: parsePgInt(row.deleted_canonical_transactions_count),
            deletedCanonicalEvents: parsePgInt(row.deleted_canonical_events_count),
        };
    }
}
