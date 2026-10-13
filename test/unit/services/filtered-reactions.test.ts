import { describe, expect, test, vi } from "vitest";

import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { PipelineEvent, PipelineTransaction, WorkerCursorPosition } from "../../../src/interfaces/pipeline.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
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
} from "../helpers/pipeline-test-helpers.js";

type Item = PipelineEvent | PipelineTransaction;

const fixture = (streamType: StreamType, count = 3, batchSize = count) => {
    const items = Array.from({ length: count }, (_, index) => streamType === "event"
        ? createPipelineEvent({ blockNumber: 100, transactionIndex: index, index })
        : createPipelineTransaction({ blockNumber: 100, index }));
    let position: WorkerCursorPosition = { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 };
    const db: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
    const order: string[] = [];
    const filter = vi.fn((_item: Item): boolean => true);
    const handler = vi.fn(async (_item: Item, _db: DbExecutor, _name: string): Promise<void> => undefined);
    const advance = vi.fn(async (
        _name: string, _chainId: number, _stream: StreamType,
        next: WorkerCursorPosition, _version: number, executor?: DbExecutor,
    ): Promise<boolean> => {
        order.push(executor === db ? "cursor" : "checkpoint");
        position = next;
        return true;
    });
    const run = vi.fn();
    const transactionManager: TransactionManager = {
        run: async <T>(callback: (db: DbExecutor) => Promise<T>): Promise<T> => {
            run();
            order.push("begin");
            const before = position;
            try {
                const result = await callback(db);
                order.push("commit");
                return result;
            } catch (error) {
                position = before;
                order.push("rollback");
                throw error;
            }
        },
    };
    const list = vi.fn(async () => items
        .filter((item) => item.index > position.lastTransactionIndex).slice(0, batchSize));
    const common = {
        config: { chainId: 7, workerName: "filtered-reaction", delayBetweenTicksMs: 1,
            batchSize, confirmations: 0 },
        filter, handler, transactionManager,
        blocksRepository: createNoopBlocksRepository(),
        chainCursorRepository: {
            ...createNoopChainCursorRepository(),
            get: async () => ({ chainId: 7, lastEnqueuedBlock: 100, lastCommittedBlock: 100,
                lastCommittedHash: HASH_A, reorgVersion: 0, updatedAt: new Date() }),
        },
        workerCursorsRepository: {
            ...createNoopWorkerCursorsRepository(),
            get: async () => ({ workerName: "filtered-reaction", chainId: 7, streamType,
                position, reorgVersion: 0, updatedAt: new Date() }),
            advanceIfVersion: advance,
        },
    };
    const createService = (withFilter = true) => streamType === "event"
        ? new ReactionService({ ...common, filter: withFilter ? filter : undefined, streamType,
            eventsRepository: { ...createNoopEventsRepository(), listAfterPosition: async () =>
                (await list()).filter((item): item is PipelineEvent => "topics" in item) } })
        : new ReactionService({ ...common, filter: withFilter ? filter : undefined, streamType,
            transactionsRepository: { ...createNoopTransactionsRepository(), listAfterPosition: async () =>
                (await list()).filter((item): item is PipelineTransaction => "hash" in item) } });
    return { createService, items, db, order, filter, handler, advance, run, list, getPosition: () => position };
};

for (const streamType of ["event", "transaction"] as const) {
    describe(`${streamType} filtered transactional reactions`, () => {
        test("accepts all items without a filter and resumes from committed progress", async () => {
            const f = fixture(streamType);
            const service = f.createService(false);
            await service.execute();
            expect(f.filter).not.toHaveBeenCalled();
            expect(f.handler.mock.calls.map(([item]) => item.index)).toEqual([0, 1, 2]);
            for (const item of f.items) {
                expect(f.handler).toHaveBeenCalledWith(item, f.db, "filtered-reaction", undefined);
            }
            expect(f.run).toHaveBeenCalledTimes(3);
            expect(f.advance.mock.calls.map((call) => call[5])).toEqual([f.db, f.db, f.db]);
            expect(f.getPosition().lastTransactionIndex).toBe(2);
            await service.execute();
            expect(f.handler).toHaveBeenCalledTimes(3);
            expect(f.run).toHaveBeenCalledTimes(3);
        });

        test("does not open transactions for an empty batch without a filter", async () => {
            const f = fixture(streamType, 0);
            await f.createService(false).execute();
            expect(f.handler).not.toHaveBeenCalled();
            expect(f.advance).not.toHaveBeenCalled();
            expect(f.run).not.toHaveBeenCalled();
        });

        test("filters in stream order before opening a transaction, using the same executor", async () => {
            const f = fixture(streamType);
            f.filter.mockImplementation((item) => {
                f.order.push(`filter:${String(item.index)}`);
                return item.index === 1;
            });
            f.handler.mockImplementation(async (item, db, name) => {
                f.order.push("handler");
                expect(item).toBe(f.items[1]);
                expect(db).toBe(f.db);
                expect(name).toBe("filtered-reaction");
            });
            await f.createService().execute();
            expect(f.order).toEqual(["filter:0", "filter:1", "begin", "handler", "cursor", "commit",
                "filter:2", "checkpoint"]);
            expect(f.run).toHaveBeenCalledTimes(1);
            expect(f.handler).toHaveBeenCalledTimes(1);
            expect(f.advance.mock.calls.map((call) => call[5])).toEqual([f.db, undefined]);
        });

        test("does not issue a tail update after the last accepted item", async () => {
            const f = fixture(streamType);
            f.filter.mockImplementation((item) => item.index === 2);
            await f.createService().execute();
            expect(f.advance).toHaveBeenCalledTimes(1);
            expect(f.getPosition().lastTransactionIndex).toBe(2);
            expect(f.order).toEqual(["begin", "cursor", "commit"]);
        });

        test("checkpoints a fully rejected batch once without handlers or transactions", async () => {
            const f = fixture(streamType);
            f.filter.mockReturnValue(false);
            await f.createService().execute();
            expect(f.filter.mock.calls.map(([item]) => item.index)).toEqual([0, 1, 2]);
            expect(f.advance).toHaveBeenCalledTimes(1);
            expect(f.getPosition().lastTransactionIndex).toBe(2);
            expect(f.run).not.toHaveBeenCalled();
            expect(f.handler).not.toHaveBeenCalled();
        });

        test.each(["filter", "handler", "cursor"] as const)(
            "preserves the skipped prefix after a %s error", async (failure) => {
            const f = fixture(streamType);
            const error = new Error(`${failure} failed`);
            f.filter.mockImplementation((item) => {
                if (item.index === 1 && failure === "filter") { throw error; }
                return item.index !== 0;
            });
            if (failure === "handler") { f.handler.mockRejectedValue(error); }
            if (failure === "cursor") { f.advance.mockRejectedValueOnce(error); }
            await expect(f.createService().execute()).rejects.toBe(error);
            expect(f.getPosition().lastTransactionIndex).toBe(0);
            expect(f.filter).toHaveBeenCalledTimes(2);
            expect(f.order.at(-1)).toBe("checkpoint");
            expect(f.handler).toHaveBeenCalledTimes(failure === "filter" ? 0 : 1);
        });

        test.each([Promise.resolve(true), 1, null, undefined])(
            "rejects nonboolean JavaScript filter results (%s)", async (value) => {
            const f = fixture(streamType);
            // @ts-expect-error Simulate an invalid JavaScript filter result.
            f.filter.mockReturnValue(value);
            await expect(f.createService().execute()).rejects.toThrow("boolean synchronously");
            expect(f.handler).not.toHaveBeenCalled();
            expect(f.run).not.toHaveBeenCalled();
            expect(f.advance).not.toHaveBeenCalled();
        });

        test("rolls back version conflicts and stops the batch without committing", async () => {
            const f = fixture(streamType);
            f.filter.mockImplementation((item) => item.index !== 0);
            f.advance.mockResolvedValue(false);
            await f.createService().execute();
            expect(f.handler).toHaveBeenCalledTimes(1);
            expect(f.advance).toHaveBeenCalledTimes(1);
            expect(f.order).toEqual(["begin", "rollback"]);
            expect(f.getPosition().lastTransactionIndex).toBe(-1);
        });

        test("retains previous commits if the next handler fails", async () => {
            const f = fixture(streamType);
            f.handler.mockImplementation(async (item) => {
                if (item.index === 2) { throw new Error("third item failed"); }
            });
            await expect(f.createService().execute()).rejects.toThrow("third item failed");
            expect(f.getPosition().lastTransactionIndex).toBe(1);
            expect(f.order).toEqual(["begin", "cursor", "commit", "begin", "cursor", "commit", "begin", "rollback"]);
        });

        test.each(["error", "conflict"] as const)(
            "retries a rejected batch from saved state after checkpoint %s", async (failure) => {
            const f = fixture(streamType, 4, 2);
            f.filter.mockReturnValue(false);
            if (failure === "error") {
                f.advance.mockRejectedValueOnce(new Error("checkpoint failed"));
                await expect(f.createService().execute()).rejects.toThrow("checkpoint failed");
            } else {
                f.advance.mockResolvedValueOnce(false);
                await f.createService().execute();
            }
            expect(f.getPosition().lastTransactionIndex).toBe(-1);
            expect(f.list).toHaveBeenCalledTimes(1);
            await f.createService().execute();
            expect(f.filter.mock.calls.map(([item]) => item.index)).toEqual([0, 1, 0, 1]);
            expect(f.getPosition().lastTransactionIndex).toBe(1);
        });

        test("checkpoints 100,000 rejected items in 100 batches and replays only the unsaved tail", async () => {
            const f = fixture(streamType, 101_000, 1000);
            f.filter.mockReturnValue(false);
            const service = f.createService();
            for (let batch = 0; batch < 100; batch += 1) { await service.execute(); }
            expect(f.filter).toHaveBeenCalledTimes(100_000);
            expect(f.advance).toHaveBeenCalledTimes(100);
            expect(f.getPosition().lastTransactionIndex).toBe(99_999);
            expect(f.handler).not.toHaveBeenCalled();
            expect(f.run).not.toHaveBeenCalled();
            f.advance.mockRejectedValueOnce(new Error("unsaved tail"));
            await expect(service.execute()).rejects.toThrow("unsaved tail");
            expect(f.getPosition().lastTransactionIndex).toBe(99_999);
            f.filter.mockClear();
            await f.createService().execute();
            expect(f.filter.mock.calls[0]?.[0].index).toBe(100_000);
            expect(f.filter).toHaveBeenCalledTimes(1000);
            expect(f.getPosition().lastTransactionIndex).toBe(100_999);
        });
    });
}
