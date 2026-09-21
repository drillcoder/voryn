import { expect, test, vi } from "vitest";

import type { SequencerWorkerOptions } from "../../../src/interfaces/options.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import { SequencerWorker } from "../../../src/workers/sequencer-worker.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    HASH_A,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test("sequencer worker create wires service execution", async () => {
    const getCursor = vi.fn(async () => null);
    const config: Omit<SequencerWorkerOptions, "sourceConfig"> = {
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
    };
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getLatestBlock: async () => ({
            chainId: 10,
            number: 0,
            hash: HASH_A,
            parentHash: HASH_A,
            timestamp: 0,
        }),
        getBlock: async () => ({ chainId: 10, number: 0, hash: HASH_A, parentHash: HASH_A, timestamp: 0 }),
        getBlockData: async () => ({
            block: { chainId: 10, number: 0, hash: HASH_A, parentHash: HASH_A, timestamp: 0 },
            transactions: [],
            logs: [],
        }),
    };

    const worker = await SequencerWorker.create({
        logLevel: "error",
        ...config,
        sourceConfig: { chainId: 10, source },
        overrides: {
            chainCursorRepository: { ...createNoopChainCursorRepository(), get: getCursor },
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            transactionManager,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(getCursor).toHaveBeenCalledWith(10);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 10,
        maxBlocksPerTick: 1,
    });
});
