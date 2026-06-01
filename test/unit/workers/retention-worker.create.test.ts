import type { RetentionWorkerOptions } from "../../../src/interfaces/options.js";
import { RetentionWorker } from "../../../src/workers/retention-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopChainCursorRepository,
    createNoopBlocksRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("retention worker create wires service execution", async () => {
    const getCursor = jest.fn(async () => null);
    const config: RetentionWorkerOptions = {
        chainId: 11,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 100,
    };

    const worker = await RetentionWorker.create({
        logLevel: "error",
        ...config,
        overrides: {
            chainCursorRepository: { ...createNoopChainCursorRepository(), get: getCursor },
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
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
