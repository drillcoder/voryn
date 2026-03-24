import { parsePgInt } from "./pg-parsers.js";
import type { RetentionStore } from "../../interfaces/stores.js";
import type { ChainId } from "../../types/chain.js";
import type { PgQueryExecutor } from "./client.js";

export class PostgresRetentionStore implements RetentionStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
    }

    async purgeRawBlocks(chainId: ChainId, olderThan: Date): Promise<number> {
        const result = await this.pool.query(
            `DELETE FROM raw_blocks WHERE chain_id = $1 AND fetched_at < $2`,
            [chainId, olderThan]
        );

        return result.rowCount ?? 0;
    }

    async purgeCanonical(chainId: ChainId, olderThan: Date): Promise<number> {
        const cutoffTimestamp = Math.floor(olderThan.getTime() / 1000);
        const result = await this.pool.query<{ target_count: bigint | number | string | null }>(
            `WITH purge_boundary AS (
                SELECT MAX(block_number) AS purge_to_block
                FROM canonical_blocks
                WHERE chain_id = $1
                  AND block_timestamp < $2
            ),
            deleted_events AS (
                DELETE FROM canonical_events
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
            ),
            deleted_transactions AS (
                DELETE FROM canonical_transactions
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
            ),
            deleted_blocks AS (
                DELETE FROM canonical_blocks
                WHERE chain_id = $1
                  AND block_number <= (SELECT purge_to_block FROM purge_boundary)
                RETURNING 1
            )
            SELECT COUNT(*) AS target_count
            FROM deleted_blocks`,
            [chainId, cutoffTimestamp]
        );

        if (result.rows.length === 0 || result.rows[0].target_count === null) {
            return 0;
        }

        return parsePgInt(result.rows[0].target_count);
    }
}
