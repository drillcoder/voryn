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
    const infoCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const errorCalls: Array<{ message: string; meta?: Record<string, unknown> }> = [];

    const logger: Logger = {
        debug: () => undefined,
        info: (message, meta) => {
            infoCalls.push({ message, meta });
        },
        warn: () => undefined,
        error: (message, meta) => {
            errorCalls.push({ message, meta });
        },
    };

    return { logger, infoCalls, errorCalls };
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

test("polling worker start/stop logs lifecycle once", async () => {
    const deferred = createDeferred();
    const { logger, infoCalls } = createLogger();
    const worker = new TestPollingWorker(logger, async () => deferred.promise);

    await worker.start();
    await worker.start();

    const stopPromise = worker.stop();
    deferred.resolve();
    await stopPromise;

    await worker.stop();

    expect(infoCalls.map((x) => x.message)).toEqual(["worker_started", "worker_stopped"]);
});

test("polling worker logs tick failures and continues", async () => {
    const secondTickReady = createDeferred();
    const secondTickRelease = createDeferred();

    const { logger, errorCalls } = createLogger();
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
});
