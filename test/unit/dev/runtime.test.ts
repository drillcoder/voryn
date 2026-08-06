import type { Logger, WorkerLifecycle, WorkerLifecycleWithFailure } from "../../../src/index.js";
import { runWorkerLifecycle, runWorkerLifecycleWithFailure } from "../../../dev/runtime.js";

const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

test("worker runtime propagates worker failure", async () => {
    const stop = jest.fn(async () => undefined);
    let fail = (_error: Error): void => undefined;
    const worker: WorkerLifecycleWithFailure = {
        start: async () => undefined,
        stop,
        onFailure: (listener) => {
            fail = listener;
        },
    };
    const runPromise = runWorkerLifecycleWithFailure("head", worker, logger);

    fail(new Error("leader lock lost"));

    await expect(runPromise).rejects.toThrow("leader lock lost");
    expect(stop).not.toHaveBeenCalled();
});

test("worker runtime gracefully stops on a shutdown signal", async () => {
    const stop = jest.fn(async () => undefined);
    const worker: WorkerLifecycleWithFailure = {
        start: async () => undefined,
        stop,
        onFailure: () => undefined,
    };
    const runPromise = runWorkerLifecycleWithFailure("sequencer", worker, logger);
    await Promise.resolve();

    process.emit("SIGTERM", "SIGTERM");

    await expect(runPromise).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
});

test("worker runtime supports lifecycle implementations without completion notification", async () => {
    const stop = jest.fn(async () => undefined);
    const worker: WorkerLifecycle = {
        start: async () => undefined,
        stop,
    };
    const runPromise = runWorkerLifecycle("retention", worker, logger);
    await Promise.resolve();

    process.emit("SIGINT", "SIGINT");

    await expect(runPromise).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
});
