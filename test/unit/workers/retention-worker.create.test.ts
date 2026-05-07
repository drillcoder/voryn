import type { RetentionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { RetentionWorker } from "../../../src/workers/retention-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopCanonicalBlocksRepository,
    createNoopCanonicalEventsRepository,
    createNoopCanonicalTransactionsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("retention worker create wires service execution", async () => {
    const getCursor = jest.fn(async () => null);
    const config: RetentionWorkerConfig = {
        chainId: 11,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 100,
    };

    const worker = await RetentionWorker.create({
        config,
        overrides: {
            chainCursorRepository: { ...createNoopChainCursorRepository(), get: getCursor },
            blockJobsRepository: createNoopBlockJobsRepository(),
            rawBlocksRepository: createNoopRawBlocksRepository(),
            canonicalBlocksRepository: createNoopCanonicalBlocksRepository(),
            canonicalTransactionsRepository: createNoopCanonicalTransactionsRepository(),
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            transactionManager,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(getCursor).toHaveBeenCalledWith(11, expect.anything());
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 11,
        retentionDepthBlocks: 100,
    });
});
