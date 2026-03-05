import type { BlockSource } from "../src/index.js";
import type { ChainCursorStore, BlockJobQueueStore } from "../src/index.js";
import type { HeadWorkerConfig } from "../src/index.js";
import { HeadWorker } from "../src/index.js";

const defaultConfig: HeadWorkerConfig = {
    chainId: 1,
    confirmations: 2,
    pollIntervalMs: 1000,
};

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("head worker enqueues and updates cursor when safe range exists", async () => {
    const enqueueCalls: Array<{ chainId: number; fromBlock: number; toBlock: number }> = [];
    const setLastEnqueuedCalls: Array<{ chainId: number; blockNumber: number }> = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 15,
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const cursorStore: ChainCursorStore = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 8,
            lastCommittedHash: "0x1",
            updatedAt: new Date(),
        }),
        setLastEnqueued: async (chainId, blockNumber) => {
            setLastEnqueuedCalls.push({ chainId, blockNumber });
        },
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async (chainId, fromBlock, toBlock) => {
            enqueueCalls.push({ chainId, fromBlock, toBlock });
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
    };

    const worker = new HeadWorker({
        config: defaultConfig,
        source,
        cursorStore,
        jobStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(enqueueCalls).toEqual([{ chainId: 1, fromBlock: 11, toBlock: 13 }]);
    expect(setLastEnqueuedCalls).toEqual([{ chainId: 1, blockNumber: 13 }]);
});

test("head worker does nothing when safe head is negative", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 1,
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    let cursorRead = false;
    const cursorStore: ChainCursorStore = {
        get: async () => {
            cursorRead = true;
            return {
                chainId: 1,
                lastEnqueuedBlock: 0,
                lastCommittedBlock: 0,
                lastCommittedHash: "0x0",
                updatedAt: new Date(),
            };
        },
        setLastEnqueued: async () => undefined,
    };

    let enqueueCalled = false;
    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => {
            enqueueCalled = true;
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
    };

    const worker = new HeadWorker({
        config: { ...defaultConfig, confirmations: 5 },
        source,
        cursorStore,
        jobStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(cursorRead).toBe(false);
    expect(enqueueCalled).toBe(false);
});

test("head worker does nothing when cursor is already ahead of safe head", async () => {
    let setLastEnqueuedCalled = false;
    let enqueueCalled = false;

    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const cursorStore: ChainCursorStore = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 20,
            lastCommittedBlock: 19,
            lastCommittedHash: "0xabc",
            updatedAt: new Date(),
        }),
        setLastEnqueued: async () => {
            setLastEnqueuedCalled = true;
        },
    };

    const jobStore: BlockJobQueueStore = {
        enqueueRange: async () => {
            enqueueCalled = true;
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
    };

    const worker = new HeadWorker({
        config: { ...defaultConfig, confirmations: 1 },
        source,
        cursorStore,
        jobStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(enqueueCalled).toBe(false);
    expect(setLastEnqueuedCalled).toBe(false);
});
