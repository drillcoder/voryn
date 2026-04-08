import type { IsolatedDbContext } from "../../integration/helpers/test-db.js";

export interface BlockJobRow {
    status: string;
    attempts: number;
    nextRetryAt: Date | null;
    error: string | null;
}

export async function getBlockJob(
    db: IsolatedDbContext,
    blockNumber: number,
): Promise<BlockJobRow | null> {
    const result = await db.pool.query<{
        status: string;
        attempts: number;
        next_retry_at: Date | null;
        error: string | null;
    }>(
        `SELECT status, attempts, next_retry_at, error
         FROM block_jobs
         WHERE chain_id = 1
           AND block_number = $1`,
        [blockNumber]
    );

    if (result.rows.length === 0) {
        return null;
    }
    const row = result.rows[0];

    return {
        status: row.status,
        attempts: row.attempts,
        nextRetryAt: row.next_retry_at,
        error: row.error,
    };
}

export async function countRows(
    db: IsolatedDbContext,
    tableName: string,
    where?: string,
): Promise<number> {
    const whereClause = where === undefined ? "" : ` WHERE ${where}`;
    const result = await db.pool.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM ${tableName}${whereClause}`
    );

    return Number(result.rows[0]?.count ?? "0");
}
