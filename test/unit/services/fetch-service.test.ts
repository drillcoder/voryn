import type { BlockJobsRepository, RawBlocksRepository } from "../../../src/interfaces/repositories.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import type { FetchWorkerConfig } from "../../../src/interfaces/runtime.js";
import { FetchService } from "../../../src/services/fetch-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const config: FetchWorkerConfig = {
    chainId: 7,
    delayBetweenTicksMs: 1000,
    workerId: "w1",
    fetchBatchSize: 1,
    fetchClaimTtlMs: 10_000,
    retryMaxAttempts: 4,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1000,
};

const blockPayload = {
    block: {
        chainId: 7,
        number: 12,
        hash: HASH_A,
        parentHash: HASH_B,
        timestamp: 100,
        raw: {},
    },
    transactions: [],
    logs: [],
};

const createPassThroughManager = (): TransactionManager => {
    const tx: DbExecutor = {
        query: async () => ({ rows: [], rowCount: 0 }),
    };

    return {
        run: async (callback) => callback(tx),
    };
};

const createBlockJobsRepository = (overrides?: Partial<BlockJobsRepository>): BlockJobsRepository => ({
    enqueueRange: async () => undefined,
    claimForFetch: async () => null,
    markFetched: async () => undefined,
    markFetchFailed: async () => undefined,
    markCommitted: async () => undefined,
    getStatusCounts: async () => ({
        pending: 0,
        fetching: 0,
        fetched: 0,
        committed: 0,
        failed: 0,
    }),
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

const createRawBlocksRepository = (overrides?: Partial<RawBlocksRepository>): RawBlocksRepository => ({
    save: async () => undefined,
    get: async () => null,
    getProgress: async () => ({
        block: null,
        updatedAt: null,
    }),
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

test("fetch service stores fetched block and marks job fetched", async () => {
    const saved: number[] = [];
    const fetched: number[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => blockPayload,
    };

    const rawBlocksRepository = createRawBlocksRepository({
        save: async (block) => {
            saved.push(block.blockNumber);
        },
    });

    const staleThresholds: Date[] = [];
    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async (_chainId, _workerId, staleClaimedBefore) => {
            staleThresholds.push(staleClaimedBefore);
            return {
                chainId: 7,
                blockNumber: 12,
                status: "pending",
                attempts: 0,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            };
        },
        markFetched: async (_chainId, blockNumber) => {
            fetched.push(blockNumber);
        },
    });

    const worker = new FetchService(
        config,
        source,
        blockJobsRepository,
        rawBlocksRepository,
        createPassThroughManager(),
    );

    await worker.execute();

    expect(saved).toEqual([12]);
    expect(fetched).toEqual([12]);
    expect(staleThresholds[0]).toBeInstanceOf(Date);
});

test("fetch service marks failure with retry date", async () => {
    const failed: Array<{ blockNumber: number; workerId: string; nextRetryAt: Date | null }> = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => {
            throw new Error("rpc unavailable");
        },
    };

    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async () => ({
            chainId: 7,
            blockNumber: 33,
            status: "pending",
            attempts: 1,
            nextRetryAt: null,
            error: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
        }),
        markFetchFailed: async (_chainId, blockNumber, workerId, _error, nextRetryAt) => {
            failed.push({ blockNumber, workerId, nextRetryAt });
        },
    });

    const worker = new FetchService(
        config,
        source,
        blockJobsRepository,
        createRawBlocksRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(failed).toHaveLength(1);
    expect(failed[0]?.blockNumber).toBe(33);
    expect(failed[0]?.workerId).toBe("w1");
    expect(failed[0]?.nextRetryAt).toBeInstanceOf(Date);
});

test("fetch service swallows claim-lost race without failing tick", async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => blockPayload,
    };

    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async () => ({
            chainId: 7,
            blockNumber: 12,
            status: "pending",
            attempts: 0,
            nextRetryAt: null,
            error: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
        }),
        markFetched: async () => {
            throw new Error("Cannot mark block job as fetched for chain 7 block 12");
        },
        markFetchFailed: async () => {
            throw new Error("Cannot mark block job as failed for chain 7 block 12");
        },
    });

    const worker = new FetchService(
        config,
        source,
        blockJobsRepository,
        createRawBlocksRepository(),
        createPassThroughManager(),
        logger,
    );

    await expect(worker.execute()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

test("fetch service tries at least one claim when batch size is zero", async () => {
    let claims = 0;
    const worker = new FetchService(
        { ...config, fetchBatchSize: 0 },
        {
            getLatestBlockNumber: async () => 0,
            getBlockData: async () => blockPayload,
        },
        createBlockJobsRepository({
            claimForFetch: async () => {
                claims += 1;
                return null;
            },
        }),
        createRawBlocksRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(claims).toBe(1);
});

test("fetch service sets nextRetryAt=null when max attempts reached", async () => {
    let nextRetryAt: Date | null | undefined;
    const worker = new FetchService(
        config,
        {
            getLatestBlockNumber: async () => 0,
            getBlockData: async () => {
                throw new Error("fatal");
            },
        },
        createBlockJobsRepository({
            claimForFetch: async () => ({
                chainId: 7,
                blockNumber: 44,
                status: "pending",
                attempts: config.retryMaxAttempts - 1,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            }),
            markFetchFailed: async (_chainId, _blockNumber, _workerId, _error, value) => {
                nextRetryAt = value;
            },
        }),
        createRawBlocksRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(nextRetryAt).toBeNull();
});

test("fetch service swallows claim-lost during markFetchFailed", async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new FetchService(
        config,
        {
            getLatestBlockNumber: async () => 0,
            getBlockData: async () => {
                throw new Error("rpc down");
            },
        },
        createBlockJobsRepository({
            claimForFetch: async () => ({
                chainId: 7,
                blockNumber: 88,
                status: "pending",
                attempts: 0,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            }),
            markFetchFailed: async () => {
                throw new Error("Cannot mark block job as failed for chain 7 block 88");
            },
        }),
        createRawBlocksRepository(),
        createPassThroughManager(),
        logger,
    );

    await expect(worker.execute()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

test("fetch service rethrows non-claim-lost error from markFetchFailed", async () => {
    const worker = new FetchService(
        config,
        {
            getLatestBlockNumber: async () => 0,
            getBlockData: async () => {
                throw new Error("rpc down");
            },
        },
        createBlockJobsRepository({
            claimForFetch: async () => ({
                chainId: 7,
                blockNumber: 89,
                status: "pending",
                attempts: 0,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            }),
            markFetchFailed: async () => {
                throw new Error("db write failed");
            },
        }),
        createRawBlocksRepository(),
        createPassThroughManager(),
    );

    await expect(worker.execute()).rejects.toThrow("db write failed");
});
