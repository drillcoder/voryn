import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { RetentionServiceConfig } from "../../../src/services/retention-service.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../../../src/interfaces/repositories.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import { RetentionService } from "../../../src/services/retention-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const config: RetentionServiceConfig = {
    chainId: 1,
    delayBetweenTicksMs: 1000,
    retentionDepthBlocks: 42,
};

const createLogger = (): { logger: Logger; debug: jest.Mock; info: jest.Mock } => {
    const debug = jest.fn();
    const info = jest.fn();

    return {
        logger: {
            debug,
            info,
            warn: jest.fn(),
            error: jest.fn(),
        },
        debug,
        info,
    };
};

const createPassThroughManager = (): TransactionManager => {
    const transaction: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };

    return { run: async (callback) => callback(transaction) };
};

const createCursorRepository = (lastCommittedBlock = 90): ChainCursorRepository => ({
    get: async () => ({
        chainId: 1,
        lastEnqueuedBlock: 100,
        lastCommittedBlock,
        lastCommittedHash: HASH_A,
        updatedAt: new Date(),
    }),
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

const createMissingCursorRepository = (): ChainCursorRepository => ({
    get: async () => null,
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

const createBlockJobsRepository = (
    deleted: number,
    deleteBlockNumberRange: BlockJobsRepository["deleteBlockNumberRange"] = async () => deleted,
): BlockJobsRepository => ({
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
    retryAllFailed: async () => 0,
    deleteBlockNumberRange,
});

const createBlocksRepository = (
    deleted: number,
    oldestBlockNumber: number | null = 48,
    deleteBlockNumberRange: BlocksRepository["deleteBlockNumberRange"] = async () => deleted,
): BlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    getProgress: async () => null,
    getOldestBlockNumber: async () => oldestBlockNumber,
    deleteBlockNumberRange,
    deleteByBlockNumber: async () => 0,
});

const createTransactionsRepository = (
    deleted: number,
    deleteBlockNumberRange: TransactionsRepository["deleteBlockNumberRange"] = async () => deleted,
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange,
    deleteByBlockNumber: async () => 0,
});

const createEventsRepository = (
    deleted: number,
    deleteBlockNumberRange: EventsRepository["deleteBlockNumberRange"] = async () => deleted,
): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange,
    deleteByBlockNumber: async () => 0,
});

test("retention service purges committed data and logs result", async () => {
    const { logger, debug, info } = createLogger();
    const deleteBlockJobs = jest.fn(async () => 4);
    const deleteBlocks = jest.fn(async () => 3);
    const deleteTransactions = jest.fn(async () => 2);
    const deleteEvents = jest.fn(async () => 1);
    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(4, deleteBlockJobs),
        createBlocksRepository(3, 48, deleteBlocks),
        createTransactionsRepository(2, deleteTransactions),
        createEventsRepository(1, deleteEvents),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(deleteBlockJobs).toHaveBeenCalledWith(1, 48, 48, expect.any(Object));
    expect(deleteBlocks).toHaveBeenCalledWith(1, 48, 48, expect.any(Object));
    expect(deleteTransactions).toHaveBeenCalledWith(1, 48, 48, expect.any(Object));
    expect(deleteEvents).toHaveBeenCalledWith(1, 48, 48, expect.any(Object));
    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 4,
        deletedBlocks: 3,
        deletedTransactions: 2,
        deletedEvents: 1,
    });
    expect(debug).toHaveBeenCalledWith("retention_purge_stage_started", {
        chainId: 1,
        depthBlocks: 42,
        stage: "block_jobs",
        fromBlock: 48,
        toBlock: 48,
    });
    expect(debug).toHaveBeenCalledWith("retention_purge_stage_started", {
        chainId: 1,
        depthBlocks: 42,
        stage: "blocks",
        fromBlock: 48,
        toBlock: 48,
    });
    expect(debug).toHaveBeenCalledWith("retention_purge_stage_started", {
        chainId: 1,
        depthBlocks: 42,
        stage: "transactions",
        fromBlock: 48,
        toBlock: 48,
    });
    expect(debug).toHaveBeenCalledWith("retention_purge_stage_started", {
        chainId: 1,
        depthBlocks: 42,
        stage: "events",
        fromBlock: 48,
        toBlock: 48,
    });
});

test("retention service logs zero deletions when oldest block is missing", async () => {
    const { logger, debug, info } = createLogger();
    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(99),
        createBlocksRepository(99, null),
        createTransactionsRepository(99),
        createEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 0,
        deletedBlocks: 0,
        deletedTransactions: 0,
        deletedEvents: 0,
    });
    expect(debug).toHaveBeenCalledWith("retention_purge_skipped_no_blocks", {
        chainId: 1,
        depthBlocks: 42,
        lastCommittedBlock: 90,
        purgeToBlock: 48,
    });
});

test("retention service logs zero deletions when oldest block is after purge block", async () => {
    const { logger, info } = createLogger();
    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(99),
        createBlocksRepository(99, 49),
        createTransactionsRepository(99),
        createEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 0,
        deletedBlocks: 0,
        deletedTransactions: 0,
        deletedEvents: 0,
    });
});

test("retention service logs zero deletions when cursor is missing", async () => {
    const { logger, info } = createLogger();
    const worker = new RetentionService(
        config,
        createMissingCursorRepository(),
        createBlockJobsRepository(99),
        createBlocksRepository(99),
        createTransactionsRepository(99),
        createEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 0,
        deletedBlocks: 0,
        deletedTransactions: 0,
        deletedEvents: 0,
    });
});

test("retention service logs zero deletions when purge block is negative", async () => {
    const { logger, info } = createLogger();
    const worker = new RetentionService(
        { ...config, retentionDepthBlocks: 1000 },
        createCursorRepository(5),
        createBlockJobsRepository(99),
        createBlocksRepository(99),
        createTransactionsRepository(99),
        createEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 1000,
        deletedBlockJobs: 0,
        deletedBlocks: 0,
        deletedTransactions: 0,
        deletedEvents: 0,
    });
});

test("retention service uses noop logger by default", async () => {
    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(0),
        createBlocksRepository(0),
        createTransactionsRepository(0),
        createEventsRepository(0),
        createPassThroughManager(),
    );

    await expect(worker.execute()).resolves.toBeUndefined();
});
