import type { LeaderLock } from "../../interfaces/leader-lock.js";
import type { PgPool, PgPoolClient } from "./client.js";

interface AdvisoryLockRow {
    acquired: boolean;
}

interface AdvisoryUnlockRow {
    released: boolean;
}

export class PostgresLeaderLock implements LeaderLock {
    private client: PgPoolClient | null = null;

    constructor(
        private readonly pool: PgPool,
        private readonly lockKey: bigint
    ) {
    }

    async tryAcquire(): Promise<boolean> {
        if (this.client) {
            return true;
        }

        const client = await this.pool.connect();
        try {
            const result = await client.query<AdvisoryLockRow>(
                "SELECT pg_try_advisory_lock($1::BIGINT) AS acquired",
                [this.lockKey.toString()]
            );

            if (!result.rows[0]?.acquired) {
                client.release();
                return false;
            }

            this.client = client;
            return true;
        } catch (error) {
            client.release();
            throw error;
        }
    }

    async release(): Promise<void> {
        if (!this.client) {
            return;
        }

        const client = this.client;
        this.client = null;

        try {
            const result = await client.query<AdvisoryUnlockRow>(
                "SELECT pg_advisory_unlock($1::BIGINT) AS released",
                [this.lockKey.toString()]
            );

            if (!result.rows[0]?.released) {
                throw new Error(`Failed to release advisory lock with key ${this.lockKey.toString()}`);
            }
        } finally {
            client.release();
        }
    }
}
