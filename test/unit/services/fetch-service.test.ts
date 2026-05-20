import type {
    BlockJobsRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
} from "../../../src/interfaces/repositories.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import { FetchService } from "../../../src/services/fetch-service.js";
import type { FetchServiceConfig } from "../../../src/services/fetch-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
type LoggerMeta = Record<string, unknown>;

const config: FetchServiceConfig = {
    chainId: 7,
    delayBetweenTicksMs: 1000,
    instanceId: "w1",
    fetchBatchSize: 1,
    fetchConcurrency: 1,
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
    },
    transactions: [],
    logs: [],
};

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

const createDeferred = (): Deferred => {
    let resolve: (() => void) | undefined;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });

    if (resolve === undefined) {
        throw new Error("Deferred resolver was not initialized");
    }

    return { promise, resolve };
};

const waitForAsyncWork = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    get: async () => null,
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
    listFailedBlocks: async () => [],
    retryFailed: async () => 0,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createBlocksRepository = (overrides?: Partial<BlocksRepository>): BlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    getProgress: async () => null,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createTransactionsRepository = (
    overrides?: Partial<TransactionsRepository>
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createEventsRepository = (overrides?: Partial<EventsRepository>): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createSource = (getBlockData: BlockSource["getBlockData"]): BlockSource => ({
    getLatestBlockNumber: async () => 0,
    getLatestBlock: async () => blockPayload.block,
    getBlock: async () => blockPayload.block,
    getBlockData,
});

const createLogger = (): {
    logger: Logger;
    debug: jest.Mock<unknown, [string, LoggerMeta?]>;
    info: jest.Mock<unknown, [string, LoggerMeta?]>;
} => {
    const debug = jest.fn<unknown, [string, LoggerMeta?]>();
    const info = jest.fn<unknown, [string, LoggerMeta?]>();

    return {
        logger: {
            debug,
            info,
            warn: jest.fn<unknown, [string, LoggerMeta?]>(),
            error: jest.fn<unknown, [string, LoggerMeta?]>(),
        },
        debug,
        info,
    };
};

test("fetch service stores fetched block data and marks job fetched", async () => {
    const savedBlocks: number[] = [];
    const savedTransactionCounts: number[] = [];
    const savedEventCounts: number[] = [];
    const cleanupCalls: string[] = [];
    const fetched: number[] = [];

    const source = createSource(async () => blockPayload);

    const blocksRepository = createBlocksRepository({
        insert: async (block) => {
            savedBlocks.push(block.blockNumber);
        },
        deleteByBlockNumber: async (_chainId, blockNumber) => {
            cleanupCalls.push(`blocks:${String(blockNumber)}`);
            return 0;
        },
    });
    const transactionsRepository = createTransactionsRepository({
        insertMany: async (transactions) => {
            savedTransactionCounts.push(transactions.length);
        },
        deleteByBlockNumber: async (_chainId, blockNumber) => {
            cleanupCalls.push(`transactions:${String(blockNumber)}`);
            return 0;
        },
    });
    const eventsRepository = createEventsRepository({
        insertMany: async (events) => {
            savedEventCounts.push(events.length);
        },
        deleteByBlockNumber: async (_chainId, blockNumber) => {
            cleanupCalls.push(`events:${String(blockNumber)}`);
            return 0;
        },
    });

    const staleThresholds: Date[] = [];
    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async (_chainId, _instanceId, staleClaimedBefore) => {
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
        blocksRepository,
        transactionsRepository,
        eventsRepository,
        createPassThroughManager(),
    );

    await worker.execute();

    expect(cleanupCalls).toEqual(["events:12", "transactions:12", "blocks:12"]);
    expect(savedBlocks).toEqual([12]);
    expect(savedTransactionCounts).toEqual([0]);
    expect(savedEventCounts).toEqual([0]);
    expect(fetched).toEqual([12]);
    expect(staleThresholds[0]).toBeInstanceOf(Date);
});

test("fetch service writes debug logs for each fetch stage", async () => {
    const { logger, debug, info } = createLogger();
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
    });

    const worker = new FetchService(
        config,
        createSource(async () => blockPayload),
        blockJobsRepository,
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(debug).toHaveBeenCalledWith("fetch_tick_started", expect.objectContaining({
        chainId: 7,
        instanceId: "w1",
        batchSize: 1,
    }));
    expect(debug).toHaveBeenCalledWith("fetch_claim_started", expect.objectContaining({
        chainId: 7,
        instanceId: "w1",
    }));
    expect(debug).toHaveBeenCalledWith("fetch_claim_completed", expect.objectContaining({
        chainId: 7,
        instanceId: "w1",
        blockNumber: 12,
    }));
    expect(debug).toHaveBeenCalledWith("fetch_block_data_load_completed", expect.objectContaining({
        blockNumber: 12,
        transactionCount: 0,
        eventCount: 0,
    }));
    expect(debug).toHaveBeenCalledWith("fetch_block_data_save_completed", expect.objectContaining({
        blockNumber: 12,
        transactionCount: 0,
        eventCount: 0,
    }));
    expect(info).toHaveBeenCalledWith("fetch_tick_processed", expect.objectContaining({
        claimed: 1,
        fetched: 1,
        failed: 0,
    }));
});

test("fetch service reports claimed fetched and failed counts across batch", async () => {
    const { logger, info } = createLogger();
    const jobs = [12, 13, 14];
    const failedBlocks: number[] = [];
    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async () => {
            const blockNumber = jobs.shift();

            if (blockNumber === undefined) {
                return null;
            }

            return {
                chainId: 7,
                blockNumber,
                status: "pending",
                attempts: 0,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            };
        },
        markFetchFailed: async (_chainId, blockNumber) => {
            failedBlocks.push(blockNumber);
        },
    });

    const worker = new FetchService(
        { ...config, fetchBatchSize: 3, fetchConcurrency: 2 },
        createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 13) {
                throw new Error("rpc unavailable");
            }

            return blockPayload;
        }),
        blockJobsRepository,
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(failedBlocks).toEqual([13]);
    expect(info).toHaveBeenCalledWith("fetch_tick_processed", expect.objectContaining({
        claimed: 3,
        fetched: 2,
        failed: 1,
    }));
});

test("fetch service processes claimed jobs concurrently up to configured limit", async () => {
    const jobs = [12, 13, 14];
    const blockers = new Map<number, Deferred>([
        [12, createDeferred()],
        [13, createDeferred()],
        [14, createDeferred()],
    ]);
    const starts: number[] = [];
    const claimCountsAtStart: number[] = [];
    const fetchedBlocks: number[] = [];
    let claims = 0;
    let active = 0;
    let maxActive = 0;

    const blockJobsRepository = createBlockJobsRepository({
        claimForFetch: async () => {
            const blockNumber = jobs.shift();

            if (blockNumber === undefined) {
                return null;
            }

            claims += 1;
            return {
                chainId: 7,
                blockNumber,
                status: "pending",
                attempts: 0,
                nextRetryAt: null,
                error: null,
                claimedAt: new Date(),
                updatedAt: new Date(),
            };
        },
        markFetched: async (_chainId, blockNumber) => {
            fetchedBlocks.push(blockNumber);
        },
    });

    const worker = new FetchService(
        { ...config, fetchBatchSize: 3, fetchConcurrency: 2 },
        createSource(async (_chainId, blockNumber) => {
            const blocker = blockers.get(blockNumber);

            if (blocker === undefined) {
                throw new Error(`Missing blocker for block ${String(blockNumber)}`);
            }

            starts.push(blockNumber);
            claimCountsAtStart.push(claims);
            active += 1;
            maxActive = Math.max(maxActive, active);
            await blocker.promise;
            active -= 1;
            return blockPayload;
        }),
        blockJobsRepository,
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
    );

    const executePromise = worker.execute();
    await waitForAsyncWork();

    expect(starts).toEqual([12, 13]);
    expect(claimCountsAtStart).toEqual([3, 3]);
    expect(active).toBe(2);

    blockers.get(12)?.resolve();
    await waitForAsyncWork();

    expect(starts).toEqual([12, 13, 14]);
    expect(active).toBe(2);

    blockers.get(13)?.resolve();
    blockers.get(14)?.resolve();
    await executePromise;

    expect(maxActive).toBe(2);
    expect(fetchedBlocks).toEqual([12, 13, 14]);
});

test("fetch service marks failure with retry date", async () => {
    const failed: Array<{ blockNumber: number; instanceId: string; nextRetryAt: Date | null }> = [];

    const source = createSource(async () => {
        throw new Error("rpc unavailable");
    });

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
        markFetchFailed: async (_chainId, blockNumber, instanceId, _error, nextRetryAt) => {
            failed.push({ blockNumber, instanceId, nextRetryAt });
        },
    });

    const worker = new FetchService(
        config,
        source,
        blockJobsRepository,
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(failed).toHaveLength(1);
    expect(failed[0]?.blockNumber).toBe(33);
    expect(failed[0]?.instanceId).toBe("w1");
    expect(failed[0]?.nextRetryAt).toBeInstanceOf(Date);
});

test("fetch service swallows claim-lost race without failing tick", async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const source = createSource(async () => blockPayload);

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
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
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
        createSource(async () => blockPayload),
        createBlockJobsRepository({
            claimForFetch: async () => {
                claims += 1;
                return null;
            },
        }),
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(claims).toBe(1);
});

test("fetch service sets nextRetryAt=null when max attempts reached", async () => {
    let nextRetryAt: Date | null | undefined;
    const worker = new FetchService(
        config,
        createSource(async () => {
            throw new Error("fatal");
        }),
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
            markFetchFailed: async (_chainId, _blockNumber, _instanceId, _error, value) => {
                nextRetryAt = value;
            },
        }),
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
    );

    await worker.execute();

    expect(nextRetryAt).toBeNull();
});

test("fetch service swallows claim-lost during markFetchFailed", async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new FetchService(
        config,
        createSource(async () => {
            throw new Error("rpc down");
        }),
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
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
        logger,
    );

    await expect(worker.execute()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

test("fetch service rethrows non-claim-lost error from markFetchFailed", async () => {
    const worker = new FetchService(
        config,
        createSource(async () => {
            throw new Error("rpc down");
        }),
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
        createBlocksRepository(),
        createTransactionsRepository(),
        createEventsRepository(),
        createPassThroughManager(),
    );

    await expect(worker.execute()).rejects.toThrow("db write failed");
});
