import { expect, test, vi } from "vitest";

import type { ChainCursor, WorkerCursor, WorkerCursorPosition } from "../../../src/interfaces/pipeline.js";
import type { StreamType } from "../../../src/types/pipeline.js";
import { ReactionService } from "../../../src/services/reaction-service.js";
import {
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    createNoopWorkerCursorsRepository,
    createPipelineEvent,
    createPipelineTransaction,
    HASH_A,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

const position = (block: number): WorkerCursorPosition => ({
    lastBlockNumber: block, lastTransactionIndex: -1, lastLogIndex: -1,
});

const fixture = (streamType: StreamType = "event") => {
    let oldest: number | null = 100;
    let chain: ChainCursor | null = {
        chainId: 7, lastCommittedBlock: 101, lastEnqueuedBlock: 101,
        lastCommittedHash: HASH_A, reorgVersion: 0, updatedAt: new Date(),
    };
    let cursor: WorkerCursor | null = {
        workerName: "gap-test", chainId: 7, streamType,
        position: { ...position(90), lastTransactionIndex: 2, lastLogIndex: 3 },
        reorgVersion: 0, updatedAt: new Date(),
    };
    const order: string[] = [];
    const getOldestBlockNumber = vi.fn(async () => oldest);
    const getForUpdate = vi.fn(async () => chain);
    const getCursor = vi.fn(async () => cursor);
    const advanceIfVersion = vi.fn(async (
        _name: string, _chain: number, _stream: StreamType, next: WorkerCursorPosition,
    ) => {
        order.push("save");
        if (cursor !== null) { cursor = { ...cursor, position: next }; }
        return true;
    });
    const warn = vi.fn(() => { order.push("warn"); });
    const handler = vi.fn(async (): Promise<void> => { order.push("handler"); return; });
    const eventList = vi.fn(async () => [createPipelineEvent({ blockNumber: 100, index: 0, transactionIndex: 0 })]);
    const transactionList = vi.fn(async () => [createPipelineTransaction({ blockNumber: 100, index: 0 })]);
    const common = {
        filter: () => true,
        config: {
            chainId: 7, workerName: "gap-test", delayBetweenTicksMs: 1,
            batchSize: 10, confirmations: 0,
        },
        chainCursorRepository: {
            ...createNoopChainCursorRepository(), get: async () => chain, getForUpdate,
        },
        blocksRepository: { ...createNoopBlocksRepository(), getOldestBlockNumber },
        workerCursorsRepository: {
            ...createNoopWorkerCursorsRepository(), get: getCursor, advanceIfVersion,
            insert: async (
                _name: string, _chain: number, _stream: StreamType, next: WorkerCursorPosition, version: number,
            ) => {
                cursor = { workerName: "gap-test", chainId: 7, streamType, position: next,
                    reorgVersion: version, updatedAt: new Date() };
            },
        },
        transactionManager: {
            run: async <T>(callback: Parameters<typeof transactionManager.run<T>>[0]): Promise<T> => {
                const result = await transactionManager.run(callback);
                order.push("commit");
                return result;
            },
        },
        logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    };
    const createService = () => streamType === "event"
        ? new ReactionService({ ...common, streamType, handler,
            eventsRepository: { ...createNoopEventsRepository(), listAfterPosition: eventList } })
        : new ReactionService({ ...common, streamType, handler,
            transactionsRepository: { ...createNoopTransactionsRepository(), listAfterPosition: transactionList } });
    return {
        common, createService, order, getOldestBlockNumber, getForUpdate, getCursor,
        advanceIfVersion, warn, handler, eventList, transactionList,
        setOldest: (value: number | null) => { oldest = value; },
        setChain: (value: ChainCursor | null) => { chain = value; },
        getChain: () => chain,
        setCursor: (value: WorkerCursor | null) => { cursor = value; },
        getCursorState: () => cursor,
    };
};

for (const stream of ["event", "transaction"] as const) {
    test(`${stream} persists a gap before commit, warning and the first available item`, async () => {
        const f = fixture(stream);
        const previousPosition = f.getCursorState()?.position;
        await f.createService().execute();
        expect(f.order).toEqual(["save", "commit", "warn", "handler", "save", "commit"]);
        expect(f.advanceIfVersion.mock.calls[0]?.[3]).toEqual(position(100));
        expect(f.warn).toHaveBeenCalledWith("reaction_history_gap", {
            chainId: 7, workerName: "gap-test", streamType: stream, previousPosition,
            fromBlock: 90, toBlock: 99, firstAvailableBlock: 100,
        });
        expect(f.getOldestBlockNumber).toHaveBeenNthCalledWith(1, 7);
        expect(f.getOldestBlockNumber).toHaveBeenNthCalledWith(2, 7, expect.any(Object));
        if (stream === "event") {
            expect(f.eventList).toHaveBeenCalledWith(7, 101, 100, -1, -1, 10);
        } else {
            expect(f.transactionList).toHaveBeenCalledWith(7, 101, 100, -1, 10);
        }
    });

    test(`${stream} retries a failed first item after restart without repeating the gap`, async () => {
        const f = fixture(stream);
        f.handler.mockRejectedValueOnce(new Error("handler failed"));
        await expect(f.createService().execute()).rejects.toThrow("handler failed");
        expect(f.getCursorState()?.position).toEqual(position(100));
        await f.createService().execute();
        expect(f.warn).toHaveBeenCalledTimes(1);
        expect(f.handler).toHaveBeenCalledTimes(2);
    });

    test(`${stream} moves an empty stream once and reports a later gap separately`, async () => {
        const f = fixture(stream);
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        const service = f.createService();
        await service.execute();
        await service.execute();
        expect(f.getCursorState()?.position).toEqual(position(100));
        expect(f.warn).toHaveBeenCalledTimes(1);
        f.setOldest(101);
        await service.execute();
        expect(f.getCursorState()?.position).toEqual(position(101));
        expect(f.warn).toHaveBeenCalledTimes(2);
        expect(f.handler).not.toHaveBeenCalled();
    });

    test.each([null, 102, 90])(`${stream} does not infer a gap from oldest block %s`, async (oldest) => {
        const f = fixture(stream);
        f.setOldest(oldest);
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        await f.createService().execute();
        expect(f.advanceIfVersion).not.toHaveBeenCalled();
        expect(f.getForUpdate).not.toHaveBeenCalled();
        expect(f.warn).not.toHaveBeenCalled();
    });

    test(`${stream} accounts for the gap while waiting for confirmations`, async () => {
        const f = fixture(stream);
        f.common.config.confirmations = 5;
        await f.createService().execute();
        expect(f.getCursorState()?.position).toEqual(position(100));
        expect(f.warn).toHaveBeenCalledTimes(1);
        expect(f.eventList).not.toHaveBeenCalled();
        expect(f.transactionList).not.toHaveBeenCalled();
        expect(f.handler).not.toHaveBeenCalled();
    });

    test(`${stream} accounts for a gap with a zero batch`, async () => {
        const f = fixture(stream);
        f.common.config.batchSize = 0;
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        await f.createService().execute();
        expect(f.getCursorState()?.position).toEqual(position(100));
        expect(f.warn).toHaveBeenCalledTimes(1);
        expect(f.handler).not.toHaveBeenCalled();
    });

    test.each(["rejected", "error", "commit error"])(`${stream} stops when the gap write is %s`, async (failure) => {
        const f = fixture(stream);
        if (failure === "rejected") {
            f.advanceIfVersion.mockResolvedValue(false);
            await f.createService().execute();
        } else {
            if (failure === "error") {
                f.advanceIfVersion.mockRejectedValue(new Error("write failed"));
            } else {
                f.common.transactionManager.run = async (callback) => {
                    await transactionManager.run(callback);
                    throw new Error("write failed");
                };
            }
            await expect(f.createService().execute()).rejects.toThrow("write failed");
        }
        expect(f.warn).not.toHaveBeenCalled();
        expect(f.eventList).not.toHaveBeenCalled();
        expect(f.transactionList).not.toHaveBeenCalled();
        expect(f.handler).not.toHaveBeenCalled();
    });

    test.each(["chain missing", "worker missing", "chain reorg", "worker reorg"])(
        `${stream} stops when the locked state has %s`, async (change) => {
            const f = fixture(stream);
            f.getForUpdate.mockImplementation(async () => {
                if (change === "worker missing") { f.setCursor(null); }
                if (change === "worker reorg") {
                    const cursor = f.getCursorState();
                    if (cursor !== null) { f.setCursor({ ...cursor, reorgVersion: 1 }); }
                }
                const chain = f.getChain();
                if (change === "chain missing") { return null; }
                return chain === null ? null : { ...chain, reorgVersion: change === "chain reorg" ? 1 : 0 };
            });
            await f.createService().execute();
            expect(f.advanceIfVersion).not.toHaveBeenCalled();
            expect(f.warn).not.toHaveBeenCalled();
            expect(f.handler).not.toHaveBeenCalled();
        },
    );

    test.each([null, 102, 90])(`${stream} rechecks changed oldest block %s inside the transaction`, async (oldest) => {
        const f = fixture(stream);
        f.getOldestBlockNumber.mockResolvedValueOnce(100).mockResolvedValueOnce(oldest);
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        await f.createService().execute();
        expect(f.advanceIfVersion).not.toHaveBeenCalled();
        expect(f.warn).not.toHaveBeenCalled();
    });

    test(`${stream} uses the latest worker position and boundary under the lock`, async () => {
        const f = fixture(stream);
        f.getOldestBlockNumber.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
        f.getForUpdate.mockImplementation(async () => {
            const cursor = f.getCursorState();
            if (cursor !== null) { f.setCursor({ ...cursor, position: position(99) }); }
            return f.getChain();
        });
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        await f.createService().execute();
        expect(f.getCursorState()?.position).toEqual(position(101));
        expect(f.warn).toHaveBeenCalledWith("reaction_history_gap",
            expect.objectContaining({ fromBlock: 99, toBlock: 100 }));
    });

    test(`${stream} moves a newly initialized cursor from deleted history`, async () => {
        const f = fixture(stream);
        f.setCursor(null);
        const config = { ...f.common.config, initialBlock: 80 };
        f.common.config = config;
        f.eventList.mockResolvedValue([]);
        f.transactionList.mockResolvedValue([]);
        await f.createService().execute();
        expect(f.getCursorState()?.position).toEqual(position(100));
        expect(f.warn).toHaveBeenCalledWith("reaction_history_gap", expect.objectContaining({ fromBlock: 80 }));
    });
}

test("gap warning clamps the unavailable prefix at genesis", async () => {
    const f = fixture();
    const cursor = f.getCursorState();
    if (cursor !== null) { f.setCursor({ ...cursor, position: position(-1) }); }
    f.setOldest(0);
    await f.createService().execute();
    expect(f.warn).toHaveBeenCalledWith("reaction_history_gap", expect.objectContaining({ fromBlock: 0, toBlock: -1 }));
});
