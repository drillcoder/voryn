import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    DbExecutor,
    LeaderLock,
    RawBlocksRepository,
    TransactionManager,
} from "../../src/index.js";
import type { RetentionWorkerConfig } from "../../src/interfaces/runtime.js";
import { RetentionWorker } from "../../src/index.js";
import { asHash32 } from "../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const leaderLock: LeaderLock = { tryAcquire: async () => true, release: async () => undefined };

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
    "deleteUpToBlock"
>;

const createDeleteRepo = (deleted: number): DeleteRepo => ({
    deleteUpToBlock: async () => deleted,
});

const createCursorRepository = (): ChainCursorRepository => ({
    get: async () => ({
        chainId: 1,
        lastEnqueuedBlock: 100,
        lastCommittedBlock: 90,
        lastCommittedHash: HASH_A,
        updatedAt: new Date(),
    }),
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setLastCommitted: async () => undefined,
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

test("retention worker triggers purge and logs result", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
        retentionDepthBlocks: 42,
    };

    const worker = new RetentionWorker(
        config,
        createCursorRepository(),
        createBlockJobsRepository(1),
        createRawBlocksRepository(2),
        createCanonicalBlocksRepository(3),
        createCanonicalTransactionsRepository(4),
        createCanonicalEventsRepository(5),
        createPassThroughManager(),
        leaderLock,
        logger,
    );

    await invokeTick(worker);

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

test("retention worker skips when depth is non-positive", async () => {
    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
        retentionDepthBlocks: 0,
    };
    let runCalled = false;
    const manager: TransactionManager = {
        run: async () => {
            runCalled = true;
            throw new Error("must not be called");
        },
    };

    const worker = new RetentionWorker(
        config,
        createCursorRepository(),
        createBlockJobsRepository(0),
        createRawBlocksRepository(0),
        createCanonicalBlocksRepository(0),
        createCanonicalTransactionsRepository(0),
        createCanonicalEventsRepository(0),
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(runCalled).toBe(false);
});

test("retention worker logs zero deletions when cursor is missing", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
        retentionDepthBlocks: 10,
    };
    const cursorRepository: ChainCursorRepository = {
        get: async () => null,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new RetentionWorker(
        config,
        cursorRepository,
        createBlockJobsRepository(99),
        createRawBlocksRepository(99),
        createCanonicalBlocksRepository(99),
        createCanonicalTransactionsRepository(99),
        createCanonicalEventsRepository(99),
        createPassThroughManager(),
        leaderLock,
        logger,
    );

    await invokeTick(worker);

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

test("retention worker logs zero deletions when purge block is negative", async () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const config: RetentionWorkerConfig = {
        chainId: 1,
        pollIntervalMs: 1000,
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
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new RetentionWorker(
        config,
        cursorRepository,
        createBlockJobsRepository(99),
        createRawBlocksRepository(99),
        createCanonicalBlocksRepository(99),
        createCanonicalTransactionsRepository(99),
        createCanonicalEventsRepository(99),
        createPassThroughManager(),
        leaderLock,
        logger,
    );

    await invokeTick(worker);

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
