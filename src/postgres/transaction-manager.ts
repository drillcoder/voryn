import type { DbExecutor } from "../interfaces/db.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { Pool } from "pg";

export class PostgresTransactionManager implements TransactionManager {
    constructor(private readonly pool: Pool) {
    }

    async run<TResult>(callback: (transaction: DbExecutor) => Promise<TResult>): Promise<TResult> {
        const client = await this.pool.connect();
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
}
