import { beforeEach, expect, test, vi } from "vitest";

import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import { ConsoleLogger } from "../../../src/loggers/console-logger.js";
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
import type {
    FetchWorkerOptions,
    ReactionWorkerOptions,
    SingleChainSourceConfig,
} from "../../../src/interfaces/options.js";
import type { WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import { RpcPoolManager } from "@drillcoder/ethers-rpc-pool";

vi.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: vi.fn(async () => undefined),
}));

beforeEach(() => {
    vi.mocked(validatePostgresSchema).mockClear();
});

const fetchConfig: Omit<FetchWorkerOptions, "sourceConfig"> = {
    delayBetweenTicksMs: 1000,
    fetchBatchSize: 1,
    fetchConcurrency: 1,
    fetchClaimTtlMs: 1000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1000,
};

const rpcSourceConfig = (chainId = 1): SingleChainSourceConfig => ({
    network: {
        chainId,
        rpcUrls: ["http://127.0.0.1:8545"],
    },
});

const reactionConfig: ReactionWorkerOptions = {
    chainId: 1,
    workerName: "reaction-worker",
    delayBetweenTicksMs: 1000,
    batchSize: 10,
    skipFlushInterval: 10,
};

const eventHandler: EventReactionHandler = async () => "processed";

const transactionHandler: TransactionReactionHandler = async () => "processed";

const workerCursorsRepository: WorkerCursorsRepository = {
    get: async () => null,
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
};

test("fetch worker creates ethers source when an RPC source config is provided", async () => {
    const worker = await FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        sourceConfig: rpcSourceConfig(),
        overrides: {
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
        },
    });
    const service = Reflect.get(worker, "service") as FetchService;
    const source = Reflect.get(service, "source") as EthersBlockSource;

    expect(source).toBeInstanceOf(EthersBlockSource);
    expect(validatePostgresSchema).not.toHaveBeenCalled();

    await worker.stop();

    const pool = Reflect.get(source, "pool") as { getSnapshot(): { closed: boolean } };
    expect(pool.getSnapshot().closed).toBe(true);
});

test("fetch worker creates default logger with min level", async () => {
    const worker = await FetchWorker.create({
        ...fetchConfig,
        sourceConfig: rpcSourceConfig(),
        logLevel: "warn",
        overrides: {
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
        },
    });
    const workerLogger = Reflect.get(worker, "logger") as unknown;
    const service = Reflect.get(worker, "service") as FetchService;
    const serviceLogger = Reflect.get(service, "logger") as unknown;

    expect(workerLogger).toBeInstanceOf(ConsoleLogger);
    if (!(workerLogger instanceof ConsoleLogger)) {
        throw new Error("Expected worker logger to be ConsoleLogger");
    }
    expect(Reflect.get(workerLogger, "minLevel")).toBe("warn");
    expect(serviceLogger).toBe(workerLogger);
    await worker.stop();
});

test("fetch worker does not close a custom block source", async () => {
    const close = vi.fn(async () => undefined);
    const source = {
        close,
        getLatestBlockNumber: async () => 0,
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
    const worker = await FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        sourceConfig: { chainId: 1, source },
        overrides: {
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            transactionsRepository: createNoopTransactionsRepository(),
            eventsRepository: createNoopEventsRepository(),
            transactionManager,
        },
    });

    await worker.stop();

    expect(close).not.toHaveBeenCalled();
});

test("RPC-backed workers close their pool when database initialization fails", async () => {
    const initializationError = new Error("schema validation failed");
    const closeSpy = vi.spyOn(RpcPoolManager.prototype, "close");
    const dbUrl = "postgresql://voryn:voryn@127.0.0.1:5432/voryn";
    const sourceConfig = rpcSourceConfig();

    vi.mocked(validatePostgresSchema).mockRejectedValueOnce(initializationError);
    await expect(FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        sourceConfig,
        dbUrl,
    })).rejects.toBe(initializationError);

    vi.mocked(validatePostgresSchema).mockRejectedValueOnce(initializationError);
    await expect(HeadWorker.create({
        logLevel: "error",
        confirmations: 0,
        delayBetweenTicksMs: 1000,
        depthBlocks: 10,
        sourceConfig,
        dbUrl,
    })).rejects.toBe(initializationError);

    vi.mocked(validatePostgresSchema).mockRejectedValueOnce(initializationError);
    await expect(SequencerWorker.create({
        logLevel: "error",
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
        sourceConfig,
        dbUrl,
    })).rejects.toBe(initializationError);

    expect(closeSpy).toHaveBeenCalledTimes(3);
    closeSpy.mockRestore();
});

test("fetch worker merges db defaults with overrides and returns disposer", async () => {
    const claimForFetch = vi.fn(async () => null);
    const worker = await FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        sourceConfig: rpcSourceConfig(),
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
        logLevel: "error",
        ...reactionConfig,
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
        logLevel: "error",
        confirmations: 1,
        delayBetweenTicksMs: 1000,
        depthBlocks: 10,
        sourceConfig: rpcSourceConfig(7),
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
        logLevel: "error",
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
        sourceConfig: rpcSourceConfig(7),
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
        logLevel: "error",
        chainId: 7,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 1,
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
        logLevel: "error",
        ...reactionConfig,
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
        logLevel: "error",
        ...reactionConfig,
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
