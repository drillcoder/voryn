import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

interface AdvisoryLockPidRow {
    pid: number;
}

interface TerminateBackendRow {
    terminated: boolean;
}

describe("integration postgres leader lock", () => {
    let db: IsolatedDbContext;

    beforeAll(async () => {
        db = await createIsolatedDbContext(DATABASE_URL);
    });

    afterAll(async () => {
        await db.close();
    });

    test("only one holder can acquire advisory lock key at a time", async () => {
        const pool = db.pool;
        const lockA = new PostgresLeaderLock(pool, 88_000_001n);
        const lockB = new PostgresLeaderLock(pool, 88_000_001n);

        await expect(lockA.tryAcquire()).resolves.toBe(true);
        await expect(lockB.tryAcquire()).resolves.toBe(false);

        await lockA.release();

        await expect(lockB.tryAcquire()).resolves.toBe(true);
        await lockB.release();
    });

    test("reports a terminated lock backend and lets a competitor acquire promptly", async () => {
        const pool = db.pool;
        const lockKey = 88_000_002n;
        const holder = new PostgresLeaderLock(pool, lockKey);
        const competitor = new PostgresLeaderLock(pool, lockKey);
        let lossTimeout: ReturnType<typeof setTimeout> | undefined;

        try {
            await expect(holder.tryAcquire()).resolves.toBe(true);

            const lockLost = new Promise<Error>((resolve) => {
                holder.onLost(resolve);
            });
            const lockPidResult = await pool.query<AdvisoryLockPidRow>(
                `SELECT pid
                 FROM pg_locks
                 WHERE locktype = 'advisory'
                   AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
                   AND classid = (($1::BIGINT >> 32) & 4294967295)::OID
                   AND objid = ($1::BIGINT & 4294967295)::OID
                   AND objsubid = 1
                   AND mode = 'ExclusiveLock'
                   AND granted`,
                [lockKey.toString()]
            );

            expect(lockPidResult.rowCount).toBe(1);
            const lockPid = lockPidResult.rows[0]?.pid;
            expect(lockPid).toBeDefined();

            const terminateResult = await pool.query<TerminateBackendRow>(
                "SELECT pg_terminate_backend($1) AS terminated",
                [lockPid]
            );
            expect(terminateResult.rows[0]?.terminated).toBe(true);

            const boundedLockLost = Promise.race([
                lockLost,
                new Promise<never>((_resolve, reject) => {
                    lossTimeout = setTimeout(() => {
                        reject(new Error("Timed out waiting for advisory lock loss"));
                    }, 2_000);
                }),
            ]);

            await expect(boundedLockLost).resolves.toBeInstanceOf(Error);
            await expect(competitor.tryAcquire()).resolves.toBe(true);
        } finally {
            if (lossTimeout !== undefined) {
                clearTimeout(lossTimeout);
            }
            await Promise.allSettled([holder.release(), competitor.release()]);
        }
    });
});
