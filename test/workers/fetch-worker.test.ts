import type {
    BlockJobsRepository,
    BlockSource,
    DbExecutor,
    RawBlocksRepository,
    TransactionManager,
} from "../../src/index.js";
import type { FetchWorkerConfig } from "../../src/interfaces/runtime.js";
import { FetchWorker } from "../../src/index.js";
import { asHash32 } from "../../src/utils/hex.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const config: FetchWorkerConfig = {
    chainId: 7,
    pollIntervalMs: 1000,
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
    deleteUpToBlock: async () => 0,
    ...overrides,
});

test("fetch worker stores fetched block and marks job fetched", async () => {
    const saved: number[] = [];
    const fetched: number[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getBlockData: async () => blockPayload,
    };

    const rawBlocksRepository: RawBlocksRepository = {
        save: async (block) => {
            saved.push(block.blockNumber);
        },
        get: async () => null,
        deleteUpToBlock: async () => 0,
    };

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

    const worker = new FetchWorker(
        "w1",
        config,
        source,
        blockJobsRepository,
        rawBlocksRepository,
        createPassThroughManager(),
    );

    await invokeTick(worker);

    expect(saved).toEqual([12]);
    expect(fetched).toEqual([12]);
    expect(staleThresholds[0]).toBeInstanceOf(Date);
});

test("fetch worker marks failure with retry date", async () => {
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

    const worker = new FetchWorker(
        "w1",
        config,
        source,
        blockJobsRepository,
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
    );

    await invokeTick(worker);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.blockNumber).toBe(33);
    expect(failed[0]?.workerId).toBe("w1");
    expect(failed[0]?.nextRetryAt).toBeInstanceOf(Date);
});

test("fetch worker swallows claim-lost race without failing tick", async () => {
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

    const worker = new FetchWorker(
        "w1",
        config,
        source,
        blockJobsRepository,
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
        logger,
    );

    await expect(invokeTick(worker)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

test("fetch worker tries at least one claim when batch size is zero", async () => {
    let claims = 0;
    const worker = new FetchWorker(
        "w1",
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
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
    );

    await invokeTick(worker);

    expect(claims).toBe(1);
});

test("fetch worker sets nextRetryAt=null when max attempts reached", async () => {
    let nextRetryAt: Date | null | undefined;
    const worker = new FetchWorker(
        "w1",
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
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
    );

    await invokeTick(worker);

    expect(nextRetryAt).toBeNull();
});

test("fetch worker swallows claim-lost during markFetchFailed", async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new FetchWorker(
        "w1",
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
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
        logger,
    );

    await expect(invokeTick(worker)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

test("fetch worker rethrows non-claim-lost error from markFetchFailed", async () => {
    const worker = new FetchWorker(
        "w1",
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
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        createPassThroughManager(),
    );

    await expect(invokeTick(worker)).rejects.toThrow("db write failed");
});
