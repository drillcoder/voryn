import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { HeadWorkerOptions } from "../../../src/interfaces/options.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("head worker create wires service execution", async () => {
    const getLatestBlockNumber = jest.fn(async () => 0);
    const debug = jest.fn<unknown, [string, Record<string, unknown>?]>();
    const logger: Logger = {
        debug,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: HeadWorkerOptions = {
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
        logger,
        ...config,
        source,
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(getLatestBlockNumber).toHaveBeenCalledWith(7);
    expect(debug.mock.calls.map(([message]) => message)).toEqual([
        "head_tick_started",
        "head_latest_block_number_load_completed",
        "head_waiting_for_safe_head",
        "head_tick_completed",
    ]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 7,
        confirmations: 1,
        depthBlocks: 10,
    });
});
