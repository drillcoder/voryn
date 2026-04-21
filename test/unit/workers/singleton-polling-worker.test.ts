import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import { SingletonPollingWorker } from "../../../src/workers/singleton-polling-worker.js";

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

const createDeferred = (): Deferred => {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

const createLogger = () => {
    const warnCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const errorCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];

    const logger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: (message, meta) => {
            warnCalls.push({ message, meta });
        },
        error: (message, meta) => {
            errorCalls.push({ message, meta });
        },
    };

    return { logger, warnCalls, errorCalls };
};

class TestSingletonWorker extends SingletonPollingWorker {
    constructor(
        logger: Logger,
        lock: LeaderLock,
        private readonly onTick: () => Promise<void>
    ) {
        super("singleton-worker", 1000, logger, lock);
    }

    protected async tick(): Promise<void> {
        await this.onTick();
    }
}

test("singleton worker rejects start when lock is held", async () => {
    const { logger, warnCalls } = createLogger();

    const lock: LeaderLock = {
        tryAcquire: async () => false,
        release: async () => undefined,
    };

    const worker = new TestSingletonWorker(logger, lock, async () => undefined);

    await expect(worker.start()).rejects.toThrow(
        'Worker "singleton-worker" did not start: lock is already held'
    );
    expect(warnCalls[0]?.message).toBe("worker_start_rejected_lock_held");
});

test("singleton worker releases lock when start fails", async () => {
    let releaseCount = 0;

    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            releaseCount += 1;
        },
    };

    const logger: Logger = {
        debug: () => undefined,
        info: () => {
            throw new Error("logger failed");
        },
        warn: () => undefined,
        error: () => undefined,
    };

    const worker = new TestSingletonWorker(logger, lock, async () => undefined);

    await expect(worker.start()).rejects.toThrow("logger failed");
    expect(releaseCount).toBe(1);
});

test("singleton worker acquires and releases lock on lifecycle", async () => {
    const { logger } = createLogger();
    const tick = createDeferred();

    let acquireCount = 0;
    let releaseCount = 0;

    const lock: LeaderLock = {
        tryAcquire: async () => {
            acquireCount += 1;
            return true;
        },
        release: async () => {
            releaseCount += 1;
        },
    };

    const worker = new TestSingletonWorker(logger, lock, async () => tick.promise);

    await worker.start();
    await worker.start();
    const stopPromise = worker.stop();
    tick.resolve();
    await stopPromise;

    expect(acquireCount).toBe(1);
    expect(releaseCount).toBe(1);
});

test("singleton worker stop without start does not release lock", async () => {
    const { logger } = createLogger();
    let releaseCount = 0;

    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            releaseCount += 1;
        },
    };

    const worker = new TestSingletonWorker(logger, lock, async () => undefined);

    await worker.stop();

    expect(releaseCount).toBe(0);
});

test("singleton worker logs release errors and clears lock state", async () => {
    const { logger, errorCalls } = createLogger();

    const firstTick = createDeferred();

    let acquireCount = 0;
    let releaseCount = 0;

    const lock: LeaderLock = {
        tryAcquire: async () => {
            acquireCount += 1;
            return true;
        },
        release: async () => {
            releaseCount += 1;
            throw new Error("release failed");
        },
    };

    const worker = new TestSingletonWorker(logger, lock, async () => firstTick.promise);

    await worker.start();
    const firstStop = worker.stop();
    firstTick.resolve();
    await firstStop;

    await worker.stop();
    await expect(worker.start()).rejects.toThrow(
        'Worker "singleton-worker" cannot be started because its lifecycle is finalized'
    );

    expect(acquireCount).toBe(1);
    expect(releaseCount).toBe(1);
    expect(errorCalls.map((x) => x.message)).toEqual([
        "worker_lock_release_failed",
    ]);
});
