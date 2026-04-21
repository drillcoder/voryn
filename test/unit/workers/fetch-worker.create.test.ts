import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { FetchWorkerConfig } from "../../../src/interfaces/runtime.js";
import { FetchWorker } from "../../../src/workers/fetch-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopRawBlocksRepository,
    invokeTick,
    transactionManager,
} from "./worker-test-helpers.js";

test("fetch worker create wires service execution", async () => {
    const claimForFetch = jest.fn(async () => null);
    const config: FetchWorkerConfig = {
        chainId: 1,
        delayBetweenTicksMs: 1000,
        workerId: "fetch-w1",
        fetchBatchSize: 1,
        fetchClaimTtlMs: 1000,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 1000,
    };
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    const worker = FetchWorker.create({
        config,
        source,
        overrides: {
            blockJobsRepository: { ...createNoopBlockJobsRepository(), claimForFetch },
            rawBlocksRepository: createNoopRawBlocksRepository(),
            transactionManager,
        },
    });

    await invokeTick(worker);

    expect(claimForFetch).toHaveBeenCalledWith(1, "fetch-w1", expect.any(Date));
});
