import type { RetentionStore } from "../../src/index.js";
import type { RetentionWorkerConfig } from "../../src/index.js";
import { RetentionWorker } from "../../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

afterEach(() => {
    jest.restoreAllMocks();
});

test("retention worker triggers purge with configured depth and logs result", async () => {
    const purgeCalls: number[] = [];
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
        retention: {
            depthBlocks: 42,
        },
    };

    const store: RetentionStore = {
        purge: async (_chainId, depthBlocks) => {
            purgeCalls.push(depthBlocks);
            return {
                deletedBlockJobs: 0,
                deletedRawBlocks: 0,
                deletedCanonicalEvents: 0,
                deletedCanonicalTransactions: 0,
                deletedCanonicalBlocks: 0,
            };
        },
    };

    const worker = new RetentionWorker({
        config,
        store,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
        logger,
    });

    await invokeTick(worker);

    expect(purgeCalls).toEqual([42]);
    expect(logger.info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 0,
        deletedRawBlocks: 0,
        deletedCanonicalEvents: 0,
        deletedCanonicalTransactions: 0,
        deletedCanonicalBlocks: 0,
    });
});

test("retention worker skips disabled retention windows", async () => {
    let purgeCalled = false;

    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
        retention: {
            depthBlocks: 0,
        },
    };

    const store: RetentionStore = {
        purge: async () => {
            purgeCalled = true;
            return {
                deletedBlockJobs: 0,
                deletedRawBlocks: 0,
                deletedCanonicalEvents: 0,
                deletedCanonicalTransactions: 0,
                deletedCanonicalBlocks: 0,
            };
        },
    };

    const worker = new RetentionWorker({
        config,
        store,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(purgeCalled).toBe(false);
});
