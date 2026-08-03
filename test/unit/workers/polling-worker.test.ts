import type { Logger } from "../../../src/interfaces/logger.js";
import { PollingWorker } from "../../../src/workers/polling-worker.js";

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
    const debugCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const infoCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const errorCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];

    const logger: Logger = {
        debug: (message, meta) => {
            debugCalls.push({ message, meta });
        },
        info: (message, meta) => {
            infoCalls.push({ message, meta });
        },
        warn: () => undefined,
        error: (message, meta) => {
            errorCalls.push({ message, meta });
        },
    };

    return { logger, debugCalls, infoCalls, errorCalls };
};

class TestPollingWorker extends PollingWorker {
    constructor(
        logger: Logger,
        private readonly onTick: () => Promise<void>
    ) {
        super("test-worker", 1000, logger);
    }

    protected async tick(): Promise<void> {
        await this.onTick();
    }
}

class TestPollingWorkerWithCleanup extends PollingWorker {
    constructor(
        logger: Logger,
        onTick: () => Promise<void>,
        cleanup: () => Promise<void>
    ) {
        super("test-worker", 1000, logger, cleanup);
        this.onTick = onTick;
    }

    private readonly onTick: () => Promise<void>;

    protected async tick(): Promise<void> {
        await this.onTick();
    }
}

test("polling worker start/stop logs lifecycle once", async () => {
    const deferred = createDeferred();
    const { logger, debugCalls, infoCalls } = createLogger();
    const onTick = jest.fn(async () => deferred.promise);
    const worker = new TestPollingWorker(logger, onTick);

    await worker.start();
    await worker.start();

    let stopped = false;
    const stopPromise = worker.stop().then(() => {
        stopped = true;
    });
    await Promise.resolve();

    expect(stopped).toBe(false);
    expect(infoCalls.map((call) => call.message)).toEqual(["worker_started"]);
    expect(debugCalls).toEqual([
        {
            message: "worker_tick_started",
            meta: { worker: "test-worker" },
        },
    ]);

    deferred.resolve();
    await stopPromise;

    await worker.stop();

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(infoCalls.map((x) => x.message)).toEqual(["worker_started", "worker_stopped"]);
    expect(debugCalls).toEqual([
        {
            message: "worker_tick_started",
            meta: { worker: "test-worker" },
        },
        {
            message: "worker_tick_completed",
            meta: { worker: "test-worker" },
        },
    ]);
});

test("polling worker logs tick failures and continues", async () => {
    const secondTickReady = createDeferred();
    const secondTickRelease = createDeferred();

    const { logger, debugCalls, errorCalls } = createLogger();
    let attempts = 0;

    const worker = new TestPollingWorker(logger, async () => {
        attempts += 1;
        if (attempts === 1) {
            throw new Error("boom");
        }

        secondTickReady.resolve();
        await secondTickRelease.promise;
    });

    await worker.start();
    await secondTickReady.promise;

    const stopPromise = worker.stop();
    secondTickRelease.resolve();
    await stopPromise;

    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]?.message).toBe("worker_tick_failed");
    expect(errorCalls[0]?.meta).toMatchObject({ worker: "test-worker", error: "boom" });
    expect(debugCalls.map((call) => call.message)).toEqual([
        "worker_tick_started",
        "worker_tick_started",
        "worker_tick_completed",
    ]);
});

test("polling worker calls cleanup on stop", async () => {
    const deferred = createDeferred();
    const { logger } = createLogger();
    const cleanup = jest.fn(async () => undefined);
    const worker = new TestPollingWorkerWithCleanup(logger, async () => deferred.promise, cleanup);

    await worker.start();

    const stopPromise = worker.stop();
    deferred.resolve();
    await stopPromise;

    expect(cleanup).toHaveBeenCalledTimes(1);
});

test("polling worker interrupts the delay between ticks on stop", async () => {
    jest.useFakeTimers();

    try {
        const { logger } = createLogger();
        const onTick = jest.fn(async () => undefined);
        const worker = new TestPollingWorker(logger, onTick);

        await worker.start();
        await jest.advanceTimersByTimeAsync(0);

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(1);

        await worker.stop();

        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
    }
});

test("polling worker cannot start after lifecycle is finalized", async () => {
    const { logger } = createLogger();
    const worker = new TestPollingWorker(logger, async () => undefined);

    await worker.stop();

    await expect(worker.start()).rejects.toThrow(
        'Worker "test-worker" cannot be started because its lifecycle is finalized'
    );
});
