import { expect, test, vi } from "vitest";

import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { HeadWorkerOptions } from "../../../src/workers/head-worker.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import { asHash32 } from "../../../src/utils/hex.js";
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
    const getLatestBlockNumber = vi.fn(async () => 0);
    const debug = vi.fn<(message: string, meta?: Record<string, unknown>) => unknown>();
    const logger: Logger = {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const config: Pick<HeadWorkerOptions, "delayBetweenTicksMs" | "depthBlocks"> = {
        delayBetweenTicksMs: 1000,
        depthBlocks: 10,
    };
    const source: BlockSource = {
        getLatestBlockNumber,
        getLatestBlock: async () => {
            throw new Error("not expected");
        },
        getBlock: async () => ({
            chainId: 7,
            number: 0,
            hash: asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            parentHash: asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            timestamp: 0,
        }),
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    const worker = await HeadWorker.create({
        logger,
        ...config,
        sourceConfig: { chainId: 7, source },
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
        "head_latest_block_number_load_completed",
        "head_tick_observed",
        "head_cursor_initialization_required",
    ]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 7,
        depthBlocks: 10,
    });
});
