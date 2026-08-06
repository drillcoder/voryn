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

const ignoreLockLoss = (): void => undefined;

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
        private readonly onTick: () => Promise<void>,
        cleanup?: () => Promise<void>
    ) {
        super("singleton-worker", 1000, logger, lock, cleanup);
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
        onLost: ignoreLockLoss,
    };

    const worker = new TestSingletonWorker(logger, lock, async () => undefined);

    await expect(worker.start()).rejects.toThrow(
        'Worker "singleton-worker" did not start: lock is already held'
    );
    expect(warnCalls[0]?.message).toBe("worker_start_rejected_lock_held");
});

test("singleton worker releases lock when start fails", async () => {
    const lifecycleOrder: string[] = [];

    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            lifecycleOrder.push("release");
        },
        onLost: ignoreLockLoss,
    };

    const logger: Logger = {
        debug: () => undefined,
        info: () => {
            throw new Error("logger failed");
        },
        warn: () => undefined,
        error: () => undefined,
    };

    const worker = new TestSingletonWorker(
        logger,
        lock,
        async () => undefined,
        async () => {
            lifecycleOrder.push("cleanup");
        }
    );

    await expect(worker.start()).rejects.toThrow("logger failed");
    await worker.stop();

    expect(lifecycleOrder).toEqual(["release", "cleanup"]);
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
        onLost: ignoreLockLoss,
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

test("singleton worker coalesces concurrent stops and releases lock before cleanup", async () => {
    const { logger } = createLogger();
    const tick = createDeferred();
    const lifecycleOrder: string[] = [];

    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            lifecycleOrder.push("release");
        },
        onLost: ignoreLockLoss,
    };

    const worker = new TestSingletonWorker(
        logger,
        lock,
        async () => tick.promise,
        async () => {
            lifecycleOrder.push("cleanup");
        }
    );

    await worker.start();
    const firstStopPromise = worker.stop();
    const secondStopPromise = worker.stop();

    expect(lifecycleOrder).toEqual([]);

    tick.resolve();
    await Promise.all([firstStopPromise, secondStopPromise]);

    expect(lifecycleOrder).toEqual(["release", "cleanup"]);
});

test("singleton worker stop without start does not release lock", async () => {
    const { logger } = createLogger();
    let releaseCount = 0;

    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            releaseCount += 1;
        },
        onLost: ignoreLockLoss,
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
        onLost: ignoreLockLoss,
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

test("singleton worker stops with an error when its leader lock is lost", async () => {
    const { logger, errorCalls } = createLogger();
    const tick = createDeferred();
    const release = jest.fn(async () => undefined);
    let notifyLost = (_error: Error): void => undefined;
    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release,
        onLost: (listener) => {
            notifyLost = listener;
        },
    };
    const worker = new TestSingletonWorker(logger, lock, async () => tick.promise);

    await worker.start();
    const failure = new Promise<Error>((resolve) => {
        worker.onFailure(resolve);
    });
    notifyLost(new Error("connection lost"));

    await expect(failure).resolves.toEqual(
        new Error('Worker "singleton-worker" lost its leader lock: connection lost')
    );
    tick.resolve();
    await worker.stop();

    expect(release).toHaveBeenCalledTimes(1);
    expect(errorCalls).toContainEqual({
        message: "worker_lock_lost",
        meta: { worker: "singleton-worker", error: "connection lost" },
    });
});

test("singleton worker ignores lock errors raised during graceful release", async () => {
    const { logger, errorCalls } = createLogger();
    const tick = createDeferred();
    let notifyLost = (_error: Error): void => undefined;
    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => {
            notifyLost(new Error("socket closed during release"));
        },
        onLost: (listener) => {
            notifyLost = listener;
        },
    };
    const worker = new TestSingletonWorker(logger, lock, async () => tick.promise);

    await worker.start();
    const stopPromise = worker.stop();
    tick.resolve();

    await expect(stopPromise).resolves.toBeUndefined();
    expect(errorCalls).toEqual([]);
});

test("lock loss interrupts a graceful stop that is draining a tick", async () => {
    const { logger } = createLogger();
    const tick = createDeferred();
    let notifyLost = (_error: Error): void => undefined;
    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => undefined,
        onLost: (listener) => {
            notifyLost = listener;
            return () => undefined;
        },
    };
    const worker = new TestSingletonWorker(logger, lock, async () => tick.promise);

    await worker.start();
    const stopPromise = worker.stop();
    const failure = new Promise<Error>((resolve) => {
        worker.onFailure(resolve);
    });
    notifyLost(new Error("backend terminated"));

    await expect(failure).resolves.toEqual(
        new Error('Worker "singleton-worker" lost its leader lock: backend terminated')
    );
    tick.resolve();
    await stopPromise;
});

test("a cleanup error after lock loss does not create an unhandled rejection", async () => {
    const { logger } = createLogger();
    const tick = createDeferred();
    const cleanupError = new Error("cleanup failed");
    let notifyLost = (_error: Error): void => undefined;
    const lock: LeaderLock = {
        tryAcquire: async () => true,
        release: async () => undefined,
        onLost: (listener) => {
            notifyLost = listener;
        },
    };
    const worker = new TestSingletonWorker(
        logger,
        lock,
        async () => tick.promise,
        async () => {
            throw cleanupError;
        }
    );

    await worker.start();
    notifyLost(new Error("connection lost"));
    tick.resolve();

    await expect(worker.stop()).rejects.toBe(cleanupError);
});
