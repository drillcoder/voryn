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
import type { FetchWorkerOptions, ReactionWorkerOptions } from "../../../src/interfaces/options.js";
import type { WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";

jest.mock("ethers", () => {
    class FetchRequest {
        readonly url: string;

        constructor(url: string) {
            this.url = url;
        }
    }

    return {
        FetchRequest,
        isHexString: (value: unknown, length?: number) => (
            typeof value === "string"
            && /^0x[0-9a-fA-F]*$/.test(value)
            && (length === undefined || value.length === 2 + length * 2)
        ),
        isAddress: (value: unknown) => (
            typeof value === "string"
            && /^0x[0-9a-fA-F]{40}$/.test(value)
        ),
        getBytes: (value: unknown) => {
            if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
                throw new Error("invalid bytes");
            }

            return new Uint8Array();
        },
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
            getNetwork: async () => ({ chainId: 1n }),
        })),
    };
});

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

const fetchConfig: FetchWorkerOptions = {
    chainId: 1,
    delayBetweenTicksMs: 1000,
    fetchBatchSize: 1,
    fetchConcurrency: 1,
    fetchClaimTtlMs: 1000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1000,
};

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

test("fetch worker creates ethers source when rpcConfig is provided", async () => {
    const worker = await FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        rpcConfig: { rpcUrl: "http://127.0.0.1:8545" },
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

test("fetch worker creates default logger with min level", async () => {
    const worker = await FetchWorker.create({
        ...fetchConfig,
        rpcConfig: { rpcUrl: "http://127.0.0.1:8545" },
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
});

test("fetch worker merges db defaults with overrides and returns disposer", async () => {
    const claimForFetch = jest.fn(async () => null);
    const worker = await FetchWorker.create({
        logLevel: "error",
        ...fetchConfig,
        rpcConfig: { rpcUrl: "http://127.0.0.1:8545" },
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
        chainId: 7,
        confirmations: 1,
        delayBetweenTicksMs: 1000,
        depthBlocks: 10,
        rpcConfig: { rpcUrl: "http://127.0.0.1:8545" },
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
        chainId: 7,
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
        rpcConfig: { rpcUrl: "http://127.0.0.1:8545" },
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
