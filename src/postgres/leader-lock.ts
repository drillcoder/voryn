import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Pool, PoolClient, QueryConfig } from "pg";

const HEARTBEAT_INTERVAL_MS = 30_000;
const LOCK_QUERY_TIMEOUT_MS = 10_000;

interface TimedQueryConfig extends QueryConfig {
    query_timeout: number;
}

export class PostgresLeaderLock implements LeaderLock {
    private client: PoolClient | null = null;
    private acquired = false;
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private lostListener: ((error: Error) => void) | undefined;

    constructor(
        private readonly pool: Pool,
        private readonly lockKey: bigint
    ) {
    }

    async tryAcquire(): Promise<boolean> {
        if (this.client !== null) {
            return true;
        }

        const client = await this.pool.connect();
        this.client = client;
        client.on("error", this.onClientError);

        try {
            const result = await client.query<{ acquired: boolean }>(
                "SELECT pg_try_advisory_lock($1::BIGINT) AS acquired",
                [this.lockKey.toString()]
            );

            if (!result.rows[0]?.acquired) {
                this.releaseClient(client);
                return false;
            }

            this.acquired = true;
            this.scheduleHeartbeat();
            return true;
        } catch (error) {
            const acquisitionError = this.toError(error);
            this.releaseClient(client, acquisitionError);
            throw acquisitionError;
        }
    }

    async release(): Promise<void> {
        const client = this.client;
        if (client === null) {
            return;
        }

        this.acquired = false;
        this.clearHeartbeat();

        const query: TimedQueryConfig = {
            text: "SELECT pg_advisory_unlock($1::BIGINT) AS released",
            values: [this.lockKey.toString()],
            query_timeout: LOCK_QUERY_TIMEOUT_MS,
        };

        let released: boolean;
        try {
            const result = await client.query<{ released: boolean }>(query);
            released = result.rows[0]?.released ?? false;
        } catch (error) {
            const releaseError = this.toError(error);
            this.releaseClient(client, releaseError);
            throw releaseError;
        }

        this.releaseClient(client);
        if (!released) {
            throw new Error(`Failed to release advisory lock with key ${this.lockKey.toString()}`);
        }
    }

    onLost(listener: (error: Error) => void): void {
        this.lostListener = listener;
    }

    private scheduleHeartbeat(): void {
        this.heartbeatTimer = setTimeout(() => {
            this.heartbeatTimer = null;
            void this.heartbeat();
        }, HEARTBEAT_INTERVAL_MS);
    }

    private async heartbeat(): Promise<void> {
        const client = this.client;
        if (client === null || !this.acquired) {
            return;
        }

        try {
            const query: TimedQueryConfig = {
                text: `
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_locks
                        WHERE locktype = 'advisory'
                          AND pid = pg_backend_pid()
                          AND granted
                          AND mode = 'ExclusiveLock'
                          AND objsubid = 1
                          AND ((classid::BIGINT << 32) | objid::BIGINT) = $1::BIGINT
                    ) AS held
                `,
                values: [this.lockKey.toString()],
                query_timeout: LOCK_QUERY_TIMEOUT_MS,
            };
            const result = await client.query<{ held: boolean }>(query);

            if (!this.isActive(client)) {
                return;
            }

            if (!result.rows[0]?.held) {
                this.handleClientError(
                    client,
                    new Error(`Advisory lock with key ${this.lockKey.toString()} is no longer held by this session`)
                );
                return;
            }

            this.scheduleHeartbeat();
        } catch (error) {
            this.handleClientError(client, this.toError(error));
        }
    }

    private handleClientError(client: PoolClient, error: Error): void {
        if (this.client !== client) {
            return;
        }

        const notifyLost = this.acquired;
        this.releaseClient(client, error);

        if (!notifyLost) {
            return;
        }

        this.lostListener?.(error);
    }

    private releaseClient(client: PoolClient, error?: Error): void {
        if (this.client !== client) {
            return;
        }

        this.client = null;
        this.acquired = false;
        this.clearHeartbeat();

        client.off("error", this.onClientError);

        if (error === undefined) {
            client.release();
        } else {
            client.release(error);
        }
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer === null) {
            return;
        }

        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    private isActive(client: PoolClient): boolean {
        return this.client === client && this.acquired;
    }

    private readonly onClientError = (error: Error): void => {
        const client = this.client;
        if (client !== null) {
            this.handleClientError(client, error);
        }
    };

    private toError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }
}
