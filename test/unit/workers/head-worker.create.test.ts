import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { HeadWorkerConfig } from "../../../src/interfaces/runtime.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    invokeTick,
    leaderLock,
    transactionManager,
} from "./worker-test-helpers.js";

test("head worker create wires service execution", async () => {
    const getLatestBlockNumber = jest.fn(async () => 0);
    const config: HeadWorkerConfig = {
        chainId: 7,
        confirmations: 1,
        delayBetweenTicksMs: 1000,
        depthBlocks: 10,
    };
    const source: BlockSource = {
        getLatestBlockNumber,
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    const worker = HeadWorker.create({
        config,
        source,
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            rawBlocksRepository: createNoopRawBlocksRepository(),
            transactionManager,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(getLatestBlockNumber).toHaveBeenCalledWith(7);
});
