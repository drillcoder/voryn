import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { HeadWorkerConfig } from "../../../src/interfaces/runtime.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

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

    const worker = await HeadWorker.create({
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
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 7,
        confirmations: 1,
        depthBlocks: 10,
    });
});
