import { expect, test, vi } from "vitest";

import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type { WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";
import {
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    createNoopWorkerCursorsRepository,
    createPipelineEvent,
    createPipelineTransaction,
    HASH_A,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
};

const createWorker = async (
    streamType: "event" | "transaction",
    onHandle: () => Promise<void>,
    cursorOverrides: Partial<WorkerCursorsRepository> = {},
    lock?: LeaderLock,
): Promise<EventReactionWorker | TransactionReactionWorker> => {
    const chainCursorRepository = {
        ...createNoopChainCursorRepository(),
        get: async () => ({
            chainId: 7,
            lastEnqueuedBlock: 1,
            lastCommittedBlock: 1,
            lastCommittedHash: HASH_A,
            reorgVersion: 0,
            updatedAt: new Date(),
        }),
    };
    const workerCursorsRepository = {
        ...createNoopWorkerCursorsRepository(),
        get: async () => ({
            workerName: "reaction-test",
            chainId: 7,
            streamType,
            position: { lastBlockNumber: 0, lastTransactionIndex: -1, lastLogIndex: -1 },
            reorgVersion: 0,
            updatedAt: new Date(),
        }),
        ...cursorOverrides,
    };
    const leaderLock = lock ?? {
        tryAcquire: async () => true,
        release: async () => undefined,
        onLost: () => undefined,
    };
    const common = {
        logLevel: "error" as const,
        chainId: 7,
        workerName: "reaction-test",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
        skipFlushInterval: 10,
        confirmations: 0,
    };

    if (streamType === "event") {
        return EventReactionWorker.create({
            ...common,
            handler: async () => { await onHandle(); return "processed"; },
            overrides: {
                chainCursorRepository,
                eventsRepository: {
                    ...createNoopEventsRepository(),
                    listAfterPosition: async () => [createPipelineEvent({ chainId: 7 })],
                },
                workerCursorsRepository,
                transactionManager,
                leaderLock,
            },
        });
    }

    return TransactionReactionWorker.create({
        ...common,
        handler: async () => { await onHandle(); return "processed"; },
        overrides: {
            chainCursorRepository,
            transactionsRepository: {
                ...createNoopTransactionsRepository(),
                listAfterPosition: async () => [createPipelineTransaction({ chainId: 7 })],
            },
            workerCursorsRepository,
            transactionManager,
            leaderLock,
        },
    });
};

test.each(["event", "transaction"] as const)(
    "%s destroy waits for the handler and deletes cursor before releasing lock",
    async (streamType) => {
        const entered = deferred();
        const finish = deferred();
        const order: string[] = [];
        const deleteCursor = vi.fn(async () => { order.push("delete"); return true; });
        const lock: LeaderLock = {
            tryAcquire: async () => true,
            release: async () => { order.push("release"); },
            onLost: () => undefined,
        };
        const worker = await createWorker(streamType, async () => {
            entered.resolve();
            await finish.promise;
            order.push("handled");
        }, { delete: deleteCursor }, lock);

        await worker.start();
        await entered.promise;
        const destroying = worker.destroy();
        expect(deleteCursor).not.toHaveBeenCalled();
        finish.resolve();
        await destroying;

        expect(deleteCursor).toHaveBeenCalledWith("reaction-test", 7, streamType);
        expect(order).toEqual(["handled", "delete", "release"]);
        await worker.destroy();
        expect(deleteCursor).toHaveBeenCalledTimes(1);
    }
);

test.each(["event", "transaction"] as const)(
    "%s stop preserves cursor and destroy cannot follow stop",
    async (streamType) => {
        const entered = deferred();
        const finish = deferred();
        const deleteCursor = vi.fn(async () => true);
        const worker = await createWorker(streamType, async () => {
            entered.resolve();
            await finish.promise;
        }, { delete: deleteCursor });

        await expect(worker.destroy()).rejects.toThrow("must be running");
        await worker.start();
        await entered.promise;
        const stopping = worker.stop();
        await expect(worker.destroy()).rejects.toThrow("must be running");
        finish.resolve();
        await stopping;
        expect(deleteCursor).not.toHaveBeenCalled();
    }
);

test("destroy reports deletion failure and still releases the lock", async () => {
    const entered = deferred();
    const release = vi.fn(async () => undefined);
    const worker = await createWorker("event", async () => { entered.resolve(); }, {
        delete: async () => { throw new Error("database failed"); },
    }, {
        tryAcquire: async () => true,
        release,
        onLost: () => undefined,
    });

    await worker.start();
    await entered.promise;
    await expect(worker.destroy()).rejects.toThrow("database failed");
    expect(release).toHaveBeenCalledTimes(1);
});

test("destroy preserves the cursor if the leader lock is lost while draining", async () => {
    const entered = deferred();
    const finish = deferred();
    let notifyLost = (_error: Error): void => undefined;
    const deleteCursor = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    const worker = await createWorker("event", async () => {
        entered.resolve();
        await finish.promise;
    }, { delete: deleteCursor }, {
        tryAcquire: async () => true,
        release,
        onLost: (listener) => { notifyLost = listener; },
    });

    await worker.start();
    await entered.promise;
    const destroying = worker.destroy();
    notifyLost(new Error("connection lost"));
    finish.resolve();

    await expect(destroying).rejects.toThrow("lost its leader lock before cursor deletion");
    expect(deleteCursor).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
});
