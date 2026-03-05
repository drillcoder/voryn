import type { ChainCursorStore, SequencerCommitStore } from "../src/index.js";
import type { SequencerWorkerConfig } from "../src/index.js";
import { SequencerWorker } from "../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("sequencer worker commits next block after cursor", async () => {
    const commitCalls: Array<{ chainId: number; block: number }> = [];

    const config: SequencerWorkerConfig = {
        chainId: 10,
        pollIntervalMs: 1000,
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
