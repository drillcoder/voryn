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
        const result = await this.pool.query<{ target_count: bigint | number | string }>(
            `WITH target_blocks AS (
                SELECT block_number
                FROM canonical_blocks
                WHERE chain_id = $1
                  AND block_timestamp < $2
            ),
            deleted_events AS (
                DELETE FROM canonical_events
                WHERE chain_id = $1
                  AND block_number IN (SELECT block_number FROM target_blocks)
            ),
            deleted_transactions AS (
                DELETE FROM canonical_transactions
                WHERE chain_id = $1
                  AND block_number IN (SELECT block_number FROM target_blocks)
            ),
            deleted_blocks AS (
                DELETE FROM canonical_blocks
                WHERE chain_id = $1
                  AND block_number IN (SELECT block_number FROM target_blocks)
            )
            SELECT COUNT(*) AS target_count
            FROM target_blocks`,
            [chainId, cutoffTimestamp]
        );

        if (result.rows.length === 0) {
            return 0;
        }

        return parsePgInt(result.rows[0].target_count);
    }
}
