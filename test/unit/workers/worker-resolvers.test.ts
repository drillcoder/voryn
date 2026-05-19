import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import type { FetchService } from "../../../src/services/fetch-service.js";
import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import { FetchWorker } from "../../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import { RetentionWorker } from "../../../src/workers/retention-worker.js";
import { SequencerWorker } from "../../../src/workers/sequencer-worker.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";
import { buildReactionWorkerLockKey } from "../../../src/workers/worker-lock-keys.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopTransactionsRepository,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";
import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { FetchWorkerConfig, ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import type { WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

const fetchConfig: FetchWorkerConfig = {
    chainId: 1,
    delayBetweenTicksMs: 1000,
    fetchBatchSize: 1,
    fetchClaimTtlMs: 1000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1000,
};

const reactionConfig: ReactionWorkerConfig = {
    chainId: 1,
    workerName: "reaction-worker",
    delayBetweenTicksMs: 1000,
    batchSize: 10,
};

const eventHandler: EventReactionHandler = {
    handle: async () => undefined,
};

const transactionHandler: TransactionReactionHandler = {
    handle: async () => undefined,
};

const workerCursorsRepository: WorkerCursorsRepository = {
    get: async () => null,
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
};

test("fetch worker creates ethers source when only rpcUrl is provided", async () => {
    const worker = await FetchWorker.create({
        config: fetchConfig,
        rpcUrl: "http://127.0.0.1:8545",
        overrides: {
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
        },
    });
    const service = Reflect.get(worker, "service") as FetchService;

    expect(Reflect.get(service, "source")).toBeInstanceOf(EthersBlockSource);
    expect(validatePostgresSchema).not.toHaveBeenCalled();
});

test("fetch worker merges db defaults with overrides and returns disposer", async () => {
    const claimForFetch = jest.fn(async () => null);
    const worker = await FetchWorker.create({
        config: fetchConfig,
        rpcUrl: "http://127.0.0.1:8545",
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            blockJobsRepository: {
                ...createNoopBlockJobsRepository(),
                claimForFetch,
            },
        },
    });
    await invokeTick(worker);

    expect(claimForFetch).toHaveBeenCalledWith(1, expect.any(String), expect.any(Date));
    expect(validatePostgresSchema).toHaveBeenCalledTimes(1);
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("event reaction worker creates leader lock from worker identity", async () => {
    const worker = await EventReactionWorker.create({
        config: reactionConfig,
        handler: eventHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            eventsRepository: createNoopEventsRepository(),
            workerCursorsRepository,
        },
    });
    const createdLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(createdLeaderLock).toBeInstanceOf(PostgresLeaderLock);
    expect(Reflect.get(createdLeaderLock, "lockKey")).toBe(buildReactionWorkerLockKey("event", reactionConfig));
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("head worker with dbUrl returns singleton lock and disposer", async () => {
    const worker = await HeadWorker.create({
        config: {
            chainId: 7,
            confirmations: 1,
            delayBetweenTicksMs: 1000,
            depthBlocks: 10,
        },
        rpcUrl: "http://127.0.0.1:8545",
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            leaderLock,
        },
    });
    const resolvedLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("sequencer worker with dbUrl returns singleton lock and disposer", async () => {
    const worker = await SequencerWorker.create({
        config: {
            chainId: 7,
            delayBetweenTicksMs: 1000,
            maxBlocksPerTick: 1,
        },
        rpcUrl: "http://127.0.0.1:8545",
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            leaderLock,
        },
    });
    const resolvedLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("retention worker with dbUrl returns singleton lock and disposer", async () => {
    const worker = await RetentionWorker.create({
        config: {
            chainId: 7,
            delayBetweenTicksMs: 1000,
            retentionDepthBlocks: 1,
        },
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            leaderLock,
        },
    });
    const resolvedLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("event reaction worker uses override leader lock when provided with dbUrl", async () => {
    const worker = await EventReactionWorker.create({
        config: reactionConfig,
        handler: eventHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            eventsRepository: createNoopEventsRepository(),
            workerCursorsRepository,
            leaderLock,
        },
    });
    const resolvedLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});

test("transaction reaction worker creates leader lock from worker identity", async () => {
    const worker = await TransactionReactionWorker.create({
        config: reactionConfig,
        handler: transactionHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            workerCursorsRepository,
        },
    });
    const createdLeaderLock = Reflect.get(worker, "leaderLock") as LeaderLock;

    expect(createdLeaderLock).toBeInstanceOf(PostgresLeaderLock);
    expect(Reflect.get(createdLeaderLock, "lockKey")).toBe(buildReactionWorkerLockKey("transaction", reactionConfig));
    expect(Reflect.get(createdLeaderLock, "lockKey")).not.toBe(buildReactionWorkerLockKey("event", reactionConfig));
    expect(Reflect.get(worker, "cleanupFn")).toBeDefined();
    await worker.stop();
});
