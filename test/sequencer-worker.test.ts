import type { ChainCursorStore, SequencerCommitStore } from "../src/index.js";
import type { IngestionConfig } from "../src/index.js";
import { SequencerWorker } from "../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("sequencer worker commits next block after cursor", async () => {
    const commitCalls: Array<{ chainId: number; block: number }> = [];

    const config: IngestionConfig = {
        chainId: 10,
        confirmations: 0,
        pollIntervalMs: 1000,
        fetchBatchSize: 1,
        retry: {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
        },
        retention: {
            rawBlocksHours: 24,
            canonicalHours: 24,
        },
    };

    const cursorStore: ChainCursorStore = {
        get: async () => ({
            chainId: 10,
            lastEnqueuedBlock: 50,
            lastCommittedBlock: 40,
            lastCommittedHash: "0x123",
            updatedAt: new Date(),
        }),
        setLastEnqueued: async () => undefined,
    };

    const commitStore: SequencerCommitStore = {
        commitNextBlock: async (chainId, expectedBlockNumber) => {
            commitCalls.push({ chainId, block: expectedBlockNumber });
        },
    };

    const worker = new SequencerWorker({
        config,
        cursorStore,
        commitStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(commitCalls).toEqual([{ chainId: 10, block: 41 }]);
});
