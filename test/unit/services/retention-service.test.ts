import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository
} from "../../../src/interfaces/repositories.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import type { RetentionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { RetentionService } from "../../../src/services/retention-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const createPassThroughManager = (): TransactionManager => {
    const transaction: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
    return { run: async (callback) => callback(transaction) };
};

type DeleteRepo = Pick<
    BlockJobsRepository
    & RawBlocksRepository
    & CanonicalBlocksRepository
    & CanonicalTransactionsRepository
    & CanonicalEventsRepository,
    "deleteUpToBlock" | "deleteAfterBlock"
>;

const createDeleteRepo = (deleted: number): DeleteRepo => ({
    deleteUpToBlock: async () => deleted,
    deleteAfterBlock: async () => 0,
});

const createCursorRepository = (): ChainCursorRepository => ({
    get: async () => ({
        chainId: 1,
        lastEnqueuedBlock: 100,
        lastCommittedBlock: 90,
        lastCommittedHash: HASH_A,
        updatedAt: new Date(),
    }),
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setLastCommitted: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

const createBlockJobsRepository = (deleted: number): BlockJobsRepository => ({
    ...createDeleteRepo(deleted),
    enqueueRange: async () => undefined,
    claimForFetch: async () => null,
    markFetched: async () => undefined,
    markFetchFailed: async () => undefined,
    markCommitted: async () => undefined,
});

const createRawBlocksRepository = (deleted: number): RawBlocksRepository => ({
    ...createDeleteRepo(deleted),
    save: async () => undefined,
    get: async () => null,
});

const createCanonicalBlocksRepository = (deleted: number): CanonicalBlocksRepository => ({
    ...createDeleteRepo(deleted),
    insert: async () => undefined,
    get: async () => null,
});

const createCanonicalTransactionsRepository = (deleted: number): CanonicalTransactionsRepository => ({
    ...createDeleteRepo(deleted),
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
});

const createCanonicalEventsRepository = (deleted: number): CanonicalEventsRepository => ({
    ...createDeleteRepo(deleted),
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
});

test("retention service triggers purge and logs result", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 42,
    };

    const worker = new RetentionService(
        config,
        createCursorRepository(),
        createBlockJobsRepository(1),
        createRawBlocksRepository(2),
        createCanonicalBlocksRepository(3),
        createCanonicalTransactionsRepository(4),
        createCanonicalEventsRepository(5),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(logger.info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 42,
        deletedBlockJobs: 1,
        deletedRawBlocks: 2,
        deletedCanonicalBlocks: 3,
        deletedCanonicalTransactions: 4,
        deletedCanonicalEvents: 5,
    });
});

test("retention service logs zero deletions when cursor is missing", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 10,
    };
    const cursorRepository: ChainCursorRepository = {
        get: async () => null,
        getForUpdate: async () => null,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new RetentionService(
        config,
        cursorRepository,
        createBlockJobsRepository(99),
        createRawBlocksRepository(99),
        createCanonicalBlocksRepository(99),
        createCanonicalTransactionsRepository(99),
        createCanonicalEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(logger.info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 10,
        deletedBlockJobs: 0,
        deletedRawBlocks: 0,
        deletedCanonicalBlocks: 0,
        deletedCanonicalTransactions: 0,
        deletedCanonicalEvents: 0,
    });
});

test("retention service logs zero deletions when purge block is negative", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        delayBetweenTicksMs: 1000,
        retentionDepthBlocks: 1000,
    };

    const cursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 5,
            lastCommittedBlock: 5,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        getForUpdate: async () => null,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new RetentionService(
        config,
        cursorRepository,
        createBlockJobsRepository(99),
        createRawBlocksRepository(99),
        createCanonicalBlocksRepository(99),
        createCanonicalTransactionsRepository(99),
        createCanonicalEventsRepository(99),
        createPassThroughManager(),
        logger,
    );

    await worker.execute();

    expect(logger.info).toHaveBeenCalledWith("retention_purged", {
        chainId: 1,
        depthBlocks: 1000,
        deletedBlockJobs: 0,
        deletedRawBlocks: 0,
        deletedCanonicalBlocks: 0,
        deletedCanonicalTransactions: 0,
        deletedCanonicalEvents: 0,
    });
});
