import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { RetentionWorkerConfig } from "../../../src/interfaces/runtime.js";
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

const config: RetentionWorkerConfig = {
    chainId: 1,
    delayBetweenTicksMs: 1000,
    retentionDepthBlocks: 42,
};

const createLogger = (): { logger: Logger; info: jest.Mock } => {
    const info = jest.fn();

    return {
        logger: {
            debug: jest.fn(),
            info,
            warn: jest.fn(),
            error: jest.fn(),
        },
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
    deleteAtOrBeforeBlockNumber: async () => deleted,
    deleteAfterBlockNumber: async () => 0,
});

const createBlocksRepository = (deleted: number): BlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    getProgress: async () => null,
    deleteAtOrBeforeBlockNumber: async () => deleted,
    deleteAfterBlockNumber: async () => 0,
});

const createTransactionsRepository = (
    deleted: number,
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => deleted,
    deleteAfterBlockNumber: async () => 0,
});

const createEventsRepository = (deleted: number): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => deleted,
    deleteAfterBlockNumber: async () => 0,
});

test("retention service purges committed data and logs result", async () => {
    const { logger, info } = createLogger();
    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(4),
        createBlocksRepository(3),
        createTransactionsRepository(2),
        createEventsRepository(1),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 4,
        deletedBlocks: 3,
        deletedTransactions: 2,
        deletedEvents: 1,
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
