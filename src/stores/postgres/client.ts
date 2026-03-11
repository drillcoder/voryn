import { Pool, type PoolClient, type PoolConfig } from "pg";

export type PgPool = Pool;
export type PgPoolClient = PoolClient;

export function createPostgresPool(config?: PoolConfig): PgPool {
    return new Pool(config);
}

export async function withTransaction<TResult>(
    pool: PgPool,
    callback: (client: PgPoolClient) => Promise<TResult>
): Promise<TResult> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch {
            // Preserve the original error when rollback also fails.
        }
        throw error;
    } finally {
        client.release();
    }
}
