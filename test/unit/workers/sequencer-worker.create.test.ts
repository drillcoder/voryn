import type { SequencerWorkerConfig } from "../../../src/interfaces/runtime.js";
import { SequencerWorker } from "../../../src/workers/sequencer-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopCanonicalBlocksRepository,
    createNoopCanonicalEventsRepository,
    createNoopCanonicalTransactionsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    invokeTick,
    leaderLock,
    transactionManager,
} from "./worker-test-helpers.js";

test("sequencer worker create wires service execution", async () => {
    const getCursor = jest.fn(async () => null);
    const config: SequencerWorkerConfig = {
        chainId: 10,
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
    };

    const worker = SequencerWorker.create({
        config,
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

    expect(getCursor).toHaveBeenCalledWith(10, expect.anything());
});
