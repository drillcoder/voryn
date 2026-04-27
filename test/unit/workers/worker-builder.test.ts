import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import {
    buildEventReactionWorker,
    buildFetchWorker,
    buildHeadWorker,
    buildRetentionWorker,
    buildSequencerWorker,
    buildTransactionReactionWorker
} from "../../../src/workers/worker-builder.js";
import {
    createNoopBlockJobsRepository,
    createNoopCanonicalEventsRepository,
    createNoopCanonicalTransactionsRepository,
    createNoopRawBlocksRepository,
    leaderLock,
    transactionManager,
} from "./worker-test-helpers.js";
import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { FetchWorkerConfig, ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import type { WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { CreateTransactionReactionWorkerOptions } from "../../../src/workers/transaction-reaction-worker.js";

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

const fetchConfig: FetchWorkerConfig = {
    chainId: 1,
    delayBetweenTicksMs: 1000,
    workerId: "fetch-worker",
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
    insert: async () => undefined,
    advance: async () => undefined,
};

test("build fetch worker creates ethers source when only rpcUrl is provided", async () => {
    const { service } = await buildFetchWorker({
        config: fetchConfig,
        rpcUrl: "http://127.0.0.1:8545",
        overrides: {
            blockJobsRepository: createNoopBlockJobsRepository(),
            rawBlocksRepository: createNoopRawBlocksRepository(),
            transactionManager,
        },
    });

    expect(Reflect.get(service, "source")).toBeInstanceOf(EthersBlockSource);
    expect(validatePostgresSchema).not.toHaveBeenCalled();
});

test("build fetch worker merges db defaults with overrides and returns disposer", async () => {
    const claimForFetch = jest.fn(async () => null);
    const { service, dispose } = await buildFetchWorker({
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

    await service.execute();

    expect(claimForFetch).toHaveBeenCalledWith(1, "fetch-worker", expect.any(Date));
    expect(validatePostgresSchema).toHaveBeenCalledTimes(1);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build event reaction worker creates leader lock from lockKey", async () => {
    const { leaderLock: createdLeaderLock, dispose } = await buildEventReactionWorker({
        config: reactionConfig,
        handler: eventHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        lockKey: 123n,
        overrides: {
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            workerCursorsRepository,
        },
    });

    expect(createdLeaderLock).toBeInstanceOf(PostgresLeaderLock);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build head worker with dbUrl returns singleton lock and disposer", async () => {
    const { leaderLock: resolvedLeaderLock, dispose } = await buildHeadWorker({
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

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build sequencer worker with dbUrl returns singleton lock and disposer", async () => {
    const { leaderLock: resolvedLeaderLock, dispose } = await buildSequencerWorker({
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

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build retention worker with dbUrl returns singleton lock and disposer", async () => {
    const { leaderLock: resolvedLeaderLock, dispose } = await buildRetentionWorker({
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

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build event reaction worker uses override leader lock when provided with dbUrl", async () => {
    const { leaderLock: resolvedLeaderLock, dispose } = await buildEventReactionWorker({
        config: reactionConfig,
        handler: eventHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            workerCursorsRepository,
            leaderLock,
        },
    });

    expect(resolvedLeaderLock).toBe(leaderLock);
    expect(dispose).toBeDefined();
    await dispose?.();
});

test("build transaction reaction worker throws when lock is not configured", async () => {
    const options = {
        config: reactionConfig,
        handler: transactionHandler,
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            transactionsRepository: createNoopCanonicalTransactionsRepository(),
            workerCursorsRepository,
        },
    } as unknown as CreateTransactionReactionWorkerOptions;

    await expect(buildTransactionReactionWorker(options)).rejects.toThrow(
        "Transaction reaction worker lock is not configured: pass lockKey or overrides.leaderLock."
    );
});
