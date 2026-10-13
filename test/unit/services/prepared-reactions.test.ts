import { expect, test, vi } from "vitest";

import type {
    ChainCursor,
    PipelineEvent,
    PipelineTransaction,
    WorkerCursor,
} from "../../../src/interfaces/pipeline.js";
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

type Item = PipelineEvent | PipelineTransaction;

const fixture = (streamType: StreamType) => {
    const chain: ChainCursor = { chainId: 7, lastCommittedBlock: 100, lastEnqueuedBlock: 100,
        lastCommittedHash: HASH_A, reorgVersion: 0, updatedAt: new Date() };
    let cursor: WorkerCursor | null = { chainId: 7, workerName: "prepared", streamType,
        position: { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 },
        reorgVersion: 0, updatedAt: new Date() };
    const order: string[] = [];
    const contexts: Set<number>[] = [];
    const prepare = vi.fn(async (_items: readonly Item[]) => {
        order.push("prepare");
        const context = new Set([1]);
        contexts.push(context);
        return context;
    });
    const filter = vi.fn((item: Item, context: Set<number> | undefined) => {
        order.push(`filter:${String(item.index)}`);
        return context?.has(item.index) ?? false;
    });
    const handler = vi.fn(async (_item: Item, _db: unknown, _name: string, _context: Set<number> | undefined) => {
        order.push("handler");
    });
    const getChain = vi.fn(async (): Promise<ChainCursor | null> => chain);
    const advance = vi.fn(async (_name: string, _chain: number, _stream: StreamType,
        position: WorkerCursor["position"]) => {
        if (cursor !== null) { cursor = { ...cursor, position }; }
        return true;
    });
    const oldest = vi.fn(async (): Promise<number | null> => null);
    const events = vi.fn(async () => [0, 1, 2].map((index) => createPipelineEvent({
        blockNumber: 100, index, transactionIndex: index,
    })));
    const transactions = vi.fn(async () => [0, 1, 2].map((index) =>
        createPipelineTransaction({ blockNumber: 100, index })));
    const common = {
        config: { chainId: 7, workerName: "prepared", delayBetweenTicksMs: 1, batchSize: 3, confirmations: 0 },
        prepare, filter, handler,
        transactionManager,
        chainCursorRepository: { ...createNoopChainCursorRepository(), get: getChain, getForUpdate: getChain },
        blocksRepository: { ...createNoopBlocksRepository(), getOldestBlockNumber: oldest },
        workerCursorsRepository: { ...createNoopWorkerCursorsRepository(), get: async () => cursor,
            advanceIfVersion: advance,
            insert: async (_name: string, _chain: number, _stream: StreamType,
                position: WorkerCursor["position"], reorgVersion: number) => {
                cursor = { chainId: 7, workerName: "prepared", streamType,
                    position, reorgVersion, updatedAt: new Date() };
            } },
    };
    const unpreparedFilter = vi.fn((_item: Item) => true);
    const unpreparedHandler = vi.fn(async (
        _item: Item, _db: unknown, _name: string,
    ) => undefined);
    const unpreparedOptions = { ...common, prepare: undefined,
        filter: unpreparedFilter, handler: unpreparedHandler };
    const unpreparedService = streamType === "event"
        ? new ReactionService({ ...unpreparedOptions, streamType,
            eventsRepository: { ...createNoopEventsRepository(), listAfterPosition: events } })
        : new ReactionService({ ...unpreparedOptions, streamType,
            transactionsRepository: { ...createNoopTransactionsRepository(), listAfterPosition: transactions } });
    const service = streamType === "event"
        ? new ReactionService({ ...common, streamType,
            eventsRepository: { ...createNoopEventsRepository(), listAfterPosition: events } })
        : new ReactionService({ ...common, streamType,
            transactionsRepository: { ...createNoopTransactionsRepository(), listAfterPosition: transactions } });
    return { unpreparedService, unpreparedFilter, unpreparedHandler, contexts, service,
        prepare, filter, handler, getChain, advance, oldest, order, events, transactions,
        cursor: () => cursor, removeCursor: () => { cursor = null; } };
};

for (const stream of ["event", "transaction"] as const) {
    test(`${stream} passes undefined context when preparation is absent`, async () => {
        const f = fixture(stream);
        await f.unpreparedService.execute();
        expect(f.prepare).not.toHaveBeenCalled();
        expect(f.getChain).toHaveBeenCalledTimes(1);
        expect(f.unpreparedFilter).toHaveBeenCalledWith(expect.any(Object), undefined);
        expect(f.unpreparedHandler).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), "prepared", undefined);
    });

    test(`${stream} prepares once and passes the same batch context in stream order`, async () => {
        const f = fixture(stream);
        await f.service.execute();
        expect(f.order).toEqual(["prepare", "filter:0", "filter:1", "handler", "filter:2"]);
        expect(f.prepare.mock.calls[0]?.[0].map((item) => item.index)).toEqual([0, 1, 2]);
        const context = f.contexts[0];
        expect(f.filter.mock.calls.every((call) => call[1] === context)).toBe(true);
        expect(f.handler.mock.calls[0]?.[3]).toBe(context);
        await f.service.execute();
        expect(f.contexts[1]).not.toBe(context);
    });

    test(`${stream} does not prepare or recheck an empty batch`, async () => {
        const f = fixture(stream);
        f.events.mockResolvedValue([]);
        f.transactions.mockResolvedValue([]);
        await f.service.execute();
        expect(f.prepare).not.toHaveBeenCalled();
        expect(f.getChain).toHaveBeenCalledTimes(1);
        expect(f.advance).not.toHaveBeenCalled();
    });

    test.each(["throw", "reject"] as const)(`${stream} retries after preparation %s`, async (failure) => {
        const f = fixture(stream);
        const error = new Error("prepare failed");
        if (failure === "throw") { f.prepare.mockImplementationOnce(() => { throw error; }); }
        else { f.prepare.mockRejectedValueOnce(error); }
        await expect(f.service.execute()).rejects.toBe(error);
        expect(f.filter).not.toHaveBeenCalled();
        expect(f.handler).not.toHaveBeenCalled();
        expect(f.advance).not.toHaveBeenCalled();
        expect(f.cursor()?.position.lastTransactionIndex).toBe(-1);
        await f.service.execute();
        expect(f.prepare).toHaveBeenCalledTimes(2);
        expect(f.handler).toHaveBeenCalledTimes(1);
    });

    test.each(["changed", "missing", "error"] as const)(
        `${stream} stops on a %s chain after preparation`, async (state) => {
        const f = fixture(stream);
        const chain = await f.getChain();
        f.getChain.mockClear();
        f.getChain.mockResolvedValueOnce(chain);
        if (state === "changed" && chain !== null) {
            f.getChain.mockResolvedValueOnce({ ...chain, reorgVersion: 1 });
        }
        if (state === "missing") { f.getChain.mockResolvedValueOnce(null); }
        if (state === "error") { f.getChain.mockRejectedValueOnce(new Error("chain read failed")); }
        if (state === "error") { await expect(f.service.execute()).rejects.toThrow("chain read failed"); }
        else { await f.service.execute(); }
        expect(f.filter).not.toHaveBeenCalled();
        expect(f.handler).not.toHaveBeenCalled();
        expect(f.advance).not.toHaveBeenCalled();
    });

    test(`${stream} preserves cursor initialization on preparation failure`, async () => {
        const f = fixture(stream);
        f.removeCursor();
        f.prepare.mockRejectedValueOnce(new Error("failed"));
        await expect(f.service.execute()).rejects.toThrow("failed");
        expect(f.cursor()?.position).toEqual({ lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 });
    });

    test(`${stream} preserves a history gap checkpoint on preparation failure`, async () => {
        const f = fixture(stream);
        f.oldest.mockResolvedValue(100);
        const cursor = f.cursor();
        if (cursor === null) { throw new Error("missing cursor"); }
        cursor.position.lastBlockNumber = 90;
        f.prepare.mockRejectedValueOnce(new Error("failed"));
        await expect(f.service.execute()).rejects.toThrow("failed");
        expect(f.cursor()?.position).toEqual({ lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 });
        expect(f.advance).toHaveBeenCalledTimes(1);
    });
}
