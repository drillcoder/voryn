import type { RetentionStore } from "../src/index.js";
import type { IngestionConfig } from "../src/index.js";
import { RetentionWorker } from "../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

afterEach(() => {
    jest.restoreAllMocks();
});

test("retention worker purges both streams with calculated cutoff dates", async () => {
    const now = 10_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);

    const rawCalls: Date[] = [];
    const canonicalCalls: Date[] = [];

    const config: IngestionConfig = {
        chainId: 1,
        confirmations: 0,
        pollIntervalMs: 1000,
        fetchBatchSize: 1,
        retry: {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
        },
        retention: {
            rawBlocksHours: 2,
            canonicalHours: 5,
        },
    };

    const store: RetentionStore = {
        purgeRawBlocks: async (_chainId, olderThan) => {
            rawCalls.push(olderThan);
            return 0;
        },
        purgeCanonical: async (_chainId, olderThan) => {
            canonicalCalls.push(olderThan);
            return 0;
        },
    };

    const worker = new RetentionWorker({
        config,
        store,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(rawCalls[0]?.getTime()).toBe(now - 2 * 60 * 60 * 1000);
    expect(canonicalCalls[0]?.getTime()).toBe(now - 5 * 60 * 60 * 1000);
});

test("retention worker skips disabled retention windows", async () => {
    let rawCalled = false;
    let canonicalCalled = false;

    const config: IngestionConfig = {
        chainId: 1,
        confirmations: 0,
        pollIntervalMs: 1000,
        fetchBatchSize: 1,
        retry: {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
        },
        retention: {
            rawBlocksHours: 0,
            canonicalHours: -1,
        },
    };

    const store: RetentionStore = {
        purgeRawBlocks: async () => {
            rawCalled = true;
            return 0;
        },
        purgeCanonical: async () => {
            canonicalCalled = true;
            return 0;
        },
    };

    const worker = new RetentionWorker({
        config,
        store,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(rawCalled).toBe(false);
    expect(canonicalCalled).toBe(false);
});
