import type { BlockSource } from "../src/index.js";
import type { BlockJobQueueStore, RawBlockStore } from "../src/index.js";
import type { FetchedBlock } from "../src/index.js";
import type { FetchWorkerConfig } from "../src/index.js";
import { FetchWorker } from "../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const config: FetchWorkerConfig = {
    chainId: 7,
    pollIntervalMs: 1000,
    fetchBatchSize: 3,
    retry: {
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 1000,
    },
};

const blockPayload: FetchedBlock = {
    block: {
        chainId: 7,
        number: 12,
        hash: "0xaaa",
        parentHash: "0xbbb",
        timestamp: 100,
    },
    transactions: [],
    logs: [],
};

test("fetch worker stores fetched block and marks job fetched", async () => {
    const saved: Array<{ blockNumber: number; fetchedAt: Date }> = [];
    const markFetchedCalls: number[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => blockPayload,
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => undefined,
        claimForFetch: async (_chainId, _workerId) => ({
            chainId: 7,
            blockNumber: 12,
            status: "pending",
            attempts: 0,
            nextRetryAt: null,
            error: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
        }),
        markFetched: async (_chainId, blockNumber) => {
            markFetchedCalls.push(blockNumber);
        },
        markFetchFailed: async () => undefined,
    };

    const rawBlockStore: RawBlockStore = {
        save: async (block) => {
            saved.push({ blockNumber: block.blockNumber, fetchedAt: block.fetchedAt });
        },
        get: async () => null,
    };

    const worker = new FetchWorker({
        workerId: "w1",
        config: { ...config, fetchBatchSize: 1 },
        source,
        jobStore,
        rawBlockStore,
    });

    await invokeTick(worker);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.blockNumber).toBe(12);
    expect(saved[0]?.fetchedAt).toBeInstanceOf(Date);
    expect(markFetchedCalls).toEqual([12]);
});

test("fetch worker marks failure with retry date", async () => {
    const failed: Array<{ blockNumber: number; error: string; nextRetryAt: Date | null }> = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => {
            throw new Error("rpc unavailable");
        },
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => undefined,
        claimForFetch: async () => ({
            chainId: 7,
            blockNumber: 33,
            status: "pending",
            attempts: 1,
            nextRetryAt: null,
            error: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
        }),
        markFetched: async () => undefined,
        markFetchFailed: async (_chainId, blockNumber, error, nextRetryAt) => {
            failed.push({ blockNumber, error, nextRetryAt });
        },
    };

    const rawBlockStore: RawBlockStore = {
        save: async () => undefined,
        get: async () => null,
    };

    const worker = new FetchWorker({
        workerId: "w1",
        config: { ...config, fetchBatchSize: 1 },
        source,
        jobStore,
        rawBlockStore,
    });

    await invokeTick(worker);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.blockNumber).toBe(33);
    expect(failed[0]?.error).toBe("rpc unavailable");
    expect(failed[0]?.nextRetryAt).toBeInstanceOf(Date);
});

test("fetch worker stops retries when max attempts is reached", async () => {
    const failed: { blockNumber: number; error: string; nextRetryAt: Date | null }[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => {
            throw new Error("fatal");
        },
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => undefined,
        claimForFetch: async () => ({
            chainId: 7,
            blockNumber: 44,
            status: "pending",
            attempts: config.retry.maxAttempts - 1,
            nextRetryAt: null,
            error: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
        }),
        markFetched: async () => undefined,
        markFetchFailed: async (_chainId, blockNumber, error, nextRetryAt) => {
            failed.push({ blockNumber, error, nextRetryAt });
        },
    };

    const rawBlockStore: RawBlockStore = {
        save: async () => undefined,
        get: async () => null,
    };

    const worker = new FetchWorker({
        workerId: "w1",
        config: { ...config, fetchBatchSize: 1 },
        source,
        jobStore,
        rawBlockStore,
    });

    await invokeTick(worker);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.blockNumber).toBe(44);
    expect(failed[0]?.error).toBe("fatal");
    expect(failed[0]?.nextRetryAt).toBeNull();
});

test("fetch worker clamps batch size to at least one", async () => {
    let claims = 0;

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => blockPayload,
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => undefined,
        claimForFetch: async () => {
            claims += 1;
            return null;
        },
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
    };

    const rawBlockStore: RawBlockStore = {
        save: async () => undefined,
        get: async () => null,
    };

    const worker = new FetchWorker({
        workerId: "w1",
        config: { ...config, fetchBatchSize: 0 },
        source,
        jobStore,
        rawBlockStore,
    });

    await invokeTick(worker);

    expect(claims).toBe(1);
});
