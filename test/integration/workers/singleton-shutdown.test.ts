import { Pool } from "pg";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { SingletonPollingWorker } from "../../../src/workers/singleton-polling-worker.js";
import { getRequiredDatabaseUrl } from "../helpers/test-db.js";

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

interface CleanupState {
    poolEndPromise?: Promise<void>;
}

interface AdvisoryLockPidRow {
    pid: number;
}

interface TerminateBackendRow {
    terminated: boolean;
}

const DATABASE_URL = getRequiredDatabaseUrl();
const LOCK_KEY = 92_000_001n;

const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function createDeferred(): Deferred {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

class TestSingletonWorker extends SingletonPollingWorker {
    constructor(
        leaderLock: LeaderLock,
        private readonly onTick: () => Promise<void>,
        cleanup: () => Promise<void>,
    ) {
        super("integration-singleton-worker", 60_000, logger, leaderLock, cleanup);
    }

    protected async tick(): Promise<void> {
        await this.onTick();
    }
}

test("singleton worker releases its PostgreSQL leader lock before ending the pool", async () => {
    const workerPool = new Pool({ connectionString: DATABASE_URL });
    const competitorPool = new Pool({ connectionString: DATABASE_URL });
    const workerLock = new PostgresLeaderLock(workerPool, LOCK_KEY);
    const competitorLock = new PostgresLeaderLock(competitorPool, LOCK_KEY);
    const tick = createDeferred();
    const cleanupStarted = createDeferred();
    const cleanupState: CleanupState = {};
    let stopPromise: Promise<void> | null = null;

    const worker = new TestSingletonWorker(
        workerLock,
        async () => tick.promise,
        async () => {
            cleanupStarted.resolve();
            cleanupState.poolEndPromise = workerPool.end();
            await cleanupState.poolEndPromise;
        }
    );

    try {
        await worker.start();
        stopPromise = worker.stop();
        tick.resolve();
        await cleanupStarted.promise;

        const competitorAcquired = await competitorLock.tryAcquire();
        if (!competitorAcquired) {
            await workerLock.release();
        }

        await stopPromise;

        expect(competitorAcquired).toBe(true);
    } finally {
        tick.resolve();
        await workerLock.release();
        await competitorLock.release();
        await stopPromise?.catch(() => undefined);

        const poolEndPromise = cleanupState.poolEndPromise;
        if (poolEndPromise === undefined) {
            await workerPool.end();
        } else {
            await poolEndPromise.catch(() => undefined);
        }

        await competitorPool.end();
    }
});

test("singleton worker fails when PostgreSQL terminates its lock session", async () => {
    const workerPool = new Pool({ connectionString: DATABASE_URL });
    const competitorPool = new Pool({ connectionString: DATABASE_URL });
    const lockKey = LOCK_KEY + 1n;
    const workerLock = new PostgresLeaderLock(workerPool, lockKey);
    const competitorLock = new PostgresLeaderLock(competitorPool, lockKey);
    const tick = createDeferred();
    let workerPoolEndPromise: Promise<void> | undefined;
    const worker = new TestSingletonWorker(
        workerLock,
        async () => tick.promise,
        async () => {
            workerPoolEndPromise = workerPool.end();
            await workerPoolEndPromise;
        }
    );

    try {
        await worker.start();
        const failure = new Promise<Error>((resolve) => {
            worker.onFailure(resolve);
        });
        const pidResult = await competitorPool.query<AdvisoryLockPidRow>(
            `SELECT pid
             FROM pg_locks
             WHERE locktype = 'advisory'
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND classid::BIGINT = (($1::BIGINT >> 32) & 4294967295)
               AND objid::BIGINT = ($1::BIGINT & 4294967295)
               AND objsubid = 1
               AND mode = 'ExclusiveLock'
               AND granted`,
            [lockKey.toString()]
        );
        const lockPid = pidResult.rows[0]?.pid;
        expect(lockPid).toBeDefined();

        const terminateResult = await competitorPool.query<TerminateBackendRow>(
            "SELECT pg_terminate_backend($1) AS terminated",
            [lockPid]
        );
        expect(terminateResult.rows[0]?.terminated).toBe(true);

        const failureError = await failure;
        expect(failureError.message).toContain(
            'Worker "integration-singleton-worker" lost its leader lock'
        );
        await expect(competitorLock.tryAcquire()).resolves.toBe(true);
    } finally {
        tick.resolve();
        await worker.stop().catch(() => undefined);
        await competitorLock.release();

        if (workerPoolEndPromise === undefined) {
            await workerPool.end();
        } else {
            await workerPoolEndPromise.catch(() => undefined);
        }

        await competitorPool.end();
    }
});
