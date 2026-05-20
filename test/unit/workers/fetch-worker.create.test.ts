import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { FetchWorkerConfig } from "../../../src/interfaces/runtime.js";
import { FetchWorker } from "../../../src/workers/fetch-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    invokeStartLogMeta,
    invokeTick,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("fetch worker create wires service execution", async () => {
    const claimForFetch = jest.fn(async () => null);
    const config: FetchWorkerConfig = {
        chainId: 1,
        delayBetweenTicksMs: 1000,
        fetchBatchSize: 1,
        fetchConcurrency: 1,
        fetchClaimTtlMs: 1000,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 1000,
    };
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getLatestBlock: async () => {
            throw new Error("not expected");
        },
        getBlock: async () => {
            throw new Error("not expected");
        },
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    const worker = await FetchWorker.create({
        config,
        source,
        overrides: {
            blockJobsRepository: { ...createNoopBlockJobsRepository(), claimForFetch },
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
        },
    });

    await invokeTick(worker);

    expect(claimForFetch).toHaveBeenCalledWith(1, expect.any(String), expect.any(Date));
    const startLogMeta = invokeStartLogMeta(worker);
    expect(typeof startLogMeta.instanceId).toBe("string");
    expect(startLogMeta).toMatchObject({
        chainId: 1,
        fetchBatchSize: 1,
        fetchConcurrency: 1,
        fetchClaimTtlMs: 1000,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 1000,
    });
});
