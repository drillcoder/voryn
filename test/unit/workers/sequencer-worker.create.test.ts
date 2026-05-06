import type { SequencerWorkerConfig } from "../../../src/interfaces/runtime.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import { SequencerWorker } from "../../../src/workers/sequencer-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopCanonicalBlocksRepository,
    createNoopCanonicalEventsRepository,
    createNoopCanonicalTransactionsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    HASH_A,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("sequencer worker create wires service execution", async () => {
    const getCursor = jest.fn(async () => null);
    const config: SequencerWorkerConfig = {
        chainId: 10,
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
    };
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => ({
            block: { chainId: 10, number: 0, hash: HASH_A, parentHash: HASH_A, timestamp: 0, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const worker = await SequencerWorker.create({
        config,
        source,
        overrides: {
            chainCursorRepository: { ...createNoopChainCursorRepository(), get: getCursor },
            rawBlocksRepository: createNoopRawBlocksRepository(),
            canonicalBlocksRepository: createNoopCanonicalBlocksRepository(),
            canonicalTransactionsRepository: createNoopCanonicalTransactionsRepository(),
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            transactionManager,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(getCursor).toHaveBeenCalledWith(10);
});
