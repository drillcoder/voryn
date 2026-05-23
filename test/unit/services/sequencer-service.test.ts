import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { BlockJob, ChainCursor, PipelineBlock } from "../../../src/interfaces/pipeline.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../../../src/interfaces/repositories.js";
import type { SequencerWorkerOptions } from "../../../src/interfaces/runtime.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import type { BlockNumber, ChainId, HashHex } from "../../../src/types/chain.js";
import { SequencerService } from "../../../src/services/sequencer-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const createPassThroughManager = (): { manager: TransactionManager; transaction: DbExecutor } => {
    const transaction: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
    return {
        transaction,
        manager: { run: async (callback) => callback(transaction) },
    };
};

const createCursor = (
    lastCommittedBlock: BlockNumber,
    lastCommittedHash: HashHex,
    lastEnqueuedBlock = lastCommittedBlock,
): ChainCursor => ({
    chainId: 10,
    lastEnqueuedBlock,
    lastCommittedBlock,
    lastCommittedHash,
    updatedAt: new Date(),
});

const createBlock = (
    blockNumber: BlockNumber,
    blockHash: HashHex,
    parentHash: HashHex,
    timestamp = 1,
): PipelineBlock => ({
    chainId: 10,
    blockNumber,
    blockHash,
    parentHash,
    blockTimestamp: timestamp,
    fetchedAt: new Date(),
});

const createFetchedBlock = (
    blockNumber: BlockNumber,
    blockHash: HashHex,
    parentHash: HashHex,
    timestamp = 1,
): FetchedBlock => ({
    block: {
        chainId: 10,
        number: blockNumber,
        hash: blockHash,
        parentHash,
        timestamp,
    },
    transactions: [],
    logs: [],
});

const createJob = (blockNumber: BlockNumber, status: BlockJob["status"] = "fetched"): BlockJob => ({
    chainId: 10,
    blockNumber,
    status,
    attempts: 1,
    nextRetryAt: null,
    error: null,
    claimedAt: null,
    updatedAt: new Date(),
});

const createSource = (
    getBlockData: BlockSource["getBlockData"] = async () => createFetchedBlock(0, HASH_A, HASH_A),
): BlockSource => ({
    getLatestBlockNumber: async () => 0,
    getLatestBlock: async () => (await getBlockData(0, 0)).block,
    getBlock: async (...args) => (await getBlockData(...args)).block,
    getBlockData,
});

const createChainCursorRepository = (
    getCursor: () => ChainCursor | null,
    overrides: Partial<ChainCursorRepository> = {},
): ChainCursorRepository => ({
    get: async () => getCursor(),
    getForUpdate: async () => getCursor(),
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
    ...overrides,
});

const createBlocksRepository = (
    getBlock: (_chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor) => PipelineBlock | null,
    overrides: Partial<BlocksRepository> = {},
): BlocksRepository => ({
    get: async (chainId, blockNumber, transaction) => getBlock(chainId, blockNumber, transaction),
    getProgress: async () => null,
    insert: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createTransactionsRepository = (
    overrides: Partial<TransactionsRepository> = {},
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createEventsRepository = (overrides: Partial<EventsRepository> = {}): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createBlockJobsRepository = (overrides: Partial<BlockJobsRepository> = {}): BlockJobsRepository => ({
    enqueueRange: async () => undefined,
    get: async (_chainId, blockNumber) => createJob(blockNumber),
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

const createService = (options: {
    source?: BlockSource;
    chainCursorRepository: ChainCursorRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository?: TransactionsRepository;
    eventsRepository?: EventsRepository;
    blockJobsRepository?: BlockJobsRepository;
    transactionManager: TransactionManager;
    config?: Partial<SequencerWorkerOptions>;
    logger?: Logger;
}): SequencerService => new SequencerService(
    {
        chainId: 10,
        delayBetweenTicksMs: 1000,
        maxBlocksPerTick: 1,
        ...options.config,
    },
    options.source ?? createSource(),
    options.chainCursorRepository,
    options.blocksRepository,
    options.transactionsRepository ?? createTransactionsRepository(),
    options.eventsRepository ?? createEventsRepository(),
    options.blockJobsRepository ?? createBlockJobsRepository(),
    options.transactionManager,
    options.logger,
);

test("sequencer service commits next fetched block by advancing cursor and marking job committed", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const block = createBlock(41, HASH_B, HASH_A);

    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            advanceLastCommitted: async (_chainId, _prevBlock, _prevHash, blockNumber, blockHash, tx) => {
                calls.push(`advance:${String(blockNumber)}:${String(blockHash)}:${String(tx === transaction)}`);
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
            },
        }),
        blocksRepository: createBlocksRepository(() => block),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async (_chainId, blockNumber, tx) => {
                calls.push(`mark-committed:${String(blockNumber)}:${String(tx === transaction)}`);
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([
        `advance:41:${String(HASH_B)}:true`,
        "mark-committed:41:true",
    ]);
});

test("sequencer service commits multiple fetched blocks in one tick", async () => {
    const committed: number[] = [];
    const { manager } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const hash41 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash42 = asHash32("0x2222222222222222222222222222222222222222222222222222222222222222");

    const worker = createService({
        config: { maxBlocksPerTick: 2 },
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            advanceLastCommitted: async (_chainId, _prevBlock, _prevHash, blockNumber, blockHash) => {
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
            },
        }),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 41) {
                return createBlock(41, hash41, HASH_A, 1);
            }

            if (blockNumber === 42) {
                return createBlock(42, hash42, hash41, 2);
            }

            return null;
        }),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async (_chainId, blockNumber) => {
                committed.push(blockNumber);
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(committed).toEqual([41, 42]);
});

test("sequencer service waits when next job is not fetched", async () => {
    const { manager } = createPassThroughManager();
    const debug = jest.fn();
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        blocksRepository: createBlocksRepository(() => createBlock(10, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            get: async () => createJob(10, "fetching"),
        }),
        transactionManager: manager,
        logger: {
            debug,
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    });

    await worker.execute();

    expect(debug).toHaveBeenCalledWith("sequencer_waiting_for_block_fetch", {
        chainId: 10,
        blockNumber: 10,
        status: "fetching",
        attempts: 1,
    });
});

test("sequencer service waits when next block job is missing", async () => {
    const { manager } = createPassThroughManager();
    const debug = jest.fn();
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        blocksRepository: createBlocksRepository(() => createBlock(10, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            get: async () => null,
        }),
        transactionManager: manager,
        logger: {
            debug,
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    });

    await worker.execute();

    expect(debug).toHaveBeenCalledWith("sequencer_waiting_for_block_job", {
        chainId: 10,
        blockNumber: 10,
    });
});

test("sequencer service warns when next fetched job failed permanently", async () => {
    const { manager } = createPassThroughManager();
    const warn = jest.fn();
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        blocksRepository: createBlocksRepository(() => createBlock(10, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            get: async () => ({
                ...createJob(10, "failed"),
                attempts: 3,
                error: "rpc timeout",
                updatedAt,
            }),
        }),
        transactionManager: manager,
        logger: {
            debug: jest.fn(),
            info: jest.fn(),
            warn,
            error: jest.fn(),
        },
    });

    await worker.execute();

    expect(warn).toHaveBeenCalledWith("sequencer_blocked_by_failed_job", {
        chainId: 10,
        blockNumber: 10,
        attempts: 3,
        error: "rpc timeout",
        updatedAt,
    });
});

test("sequencer service waits when failed job still has retry date", async () => {
    const { manager } = createPassThroughManager();
    const debug = jest.fn();
    const nextRetryAt = new Date("2026-01-01T00:01:00.000Z");
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        blocksRepository: createBlocksRepository(() => createBlock(10, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            get: async () => ({
                ...createJob(10, "failed"),
                attempts: 2,
                error: "rpc timeout",
                nextRetryAt,
            }),
        }),
        transactionManager: manager,
        logger: {
            debug,
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    });

    await worker.execute();

    expect(debug).toHaveBeenCalledWith("sequencer_waiting_for_failed_job_retry", {
        chainId: 10,
        blockNumber: 10,
        attempts: 2,
        nextRetryAt,
        error: "rpc timeout",
    });
});

test("sequencer service throws when fetched job has no block data", async () => {
    const { manager } = createPassThroughManager();
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        blocksRepository: createBlocksRepository(() => null),
        transactionManager: manager,
    });

    await expect(worker.execute()).rejects.toThrow("Fetched block data is missing for chain 10 block 10");
});

test("sequencer service rolls back to common ancestor on parent hash mismatch", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash11 = asHash32("0x1212121212121212121212121212121212121212121212121212121212121212");
    const cursor = createCursor(10, oldHash10, 11);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            setPositions: async (_chainId, blockNumber, blockHash, lastEnqueuedBlock, tx) => {
                calls.push(`set-cursor:${String(blockNumber)}:${String(tx === transaction)}`);
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
                cursor.lastEnqueuedBlock = lastEnqueuedBlock;
            },
        }),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 11) {
                return createBlock(11, hash11, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-blocks-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 1;
            },
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-tx-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 2;
            },
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-events-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 3;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-jobs-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 4;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(cursor.lastCommittedBlock).toBe(9);
    expect(cursor.lastCommittedHash).toBe(hash9);
    expect(cursor.lastEnqueuedBlock).toBe(9);
    expect(calls).toEqual([
        "delete-events-after:9:true",
        "delete-tx-after:9:true",
        "delete-blocks-after:9:true",
        "delete-jobs-after:9:true",
        "set-cursor:9:true",
    ]);
});

test("sequencer service logs rollback metadata for new tables", async () => {
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);
    const warn = jest.fn();

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 11) {
                return createBlock(11, HASH_B, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async () => 3,
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async () => 4,
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async () => 5,
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async () => 6,
        }),
        transactionManager: manager,
        logger: {
            debug: jest.fn(),
            info: jest.fn(),
            warn,
            error: jest.fn(),
        },
    });

    await worker.execute();

    expect(warn).toHaveBeenCalledWith("sequencer_reorg_rollback", {
        chainId: 10,
        fromBlock: 10,
        ancestorBlock: 9,
        ancestorHash: hash9,
        deletedBlockJobs: 6,
        deletedBlocks: 3,
        deletedTransactions: 4,
        deletedEvents: 5,
    });
});

test("sequencer service skips rollback when cursor changes during rollback transaction", async () => {
    const calls: string[] = [];
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const changedCursor = createCursor(11, HASH_B, 11);
    const cursor = createCursor(10, oldHash10, 11);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            getForUpdate: async () => changedCursor,
        }),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 11) {
                return createBlock(11, HASH_B, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async () => {
                calls.push("delete-blocks");
                return 1;
            },
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-transactions");
                return 1;
            },
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-events");
                return 1;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-jobs");
                return 1;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service skips rollback when cursor is deleted during rollback transaction", async () => {
    const calls: string[] = [];
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            getForUpdate: async () => null,
        }),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 11) {
                return createBlock(11, HASH_B, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async () => {
                calls.push("delete-blocks");
                return 1;
            },
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-transactions");
                return 1;
            },
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-events");
                return 1;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-jobs");
                return 1;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service skips rollback when next block is gone during rollback transaction", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository((_chainId, blockNumber, tx) => {
            if (tx === transaction && blockNumber === 11) {
                return null;
            }

            if (blockNumber === 11) {
                return createBlock(11, HASH_B, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async () => {
                calls.push("delete-blocks");
                return 1;
            },
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-transactions");
                return 1;
            },
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-events");
                return 1;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-jobs");
                return 1;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service skips rollback when next block already matches cursor during rollback", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository((_chainId, blockNumber, tx) => {
            if (tx === transaction && blockNumber === 11) {
                return createBlock(11, HASH_B, oldHash10, 11);
            }

            if (blockNumber === 11) {
                return createBlock(11, HASH_B, newHash10, 11);
            }

            if (blockNumber === 10) {
                return createBlock(10, oldHash10, hash9, 10);
            }

            return createBlock(9, hash9, HASH_A, 9);
        }, {
            deleteAfterBlockNumber: async () => {
                calls.push("delete-blocks");
                return 1;
            },
        }),
        transactionsRepository: createTransactionsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-transactions");
                return 1;
            },
        }),
        eventsRepository: createEventsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-events");
                return 1;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlockNumber: async () => {
                calls.push("delete-jobs");
                return 1;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service throws when common ancestor cannot be found during rollback", async () => {
    const { manager } = createPassThroughManager();
    const oldHash = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const sourceHash = asHash32("0x2020202020202020202020202020202020202020202020202020202020202020");
    const nextHash = asHash32("0x3030303030303030303030303030303030303030303030303030303030303030");
    const cursor = createCursor(1, oldHash, 2);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => createFetchedBlock(blockNumber, sourceHash, HASH_A)),
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 2) {
                return createBlock(2, nextHash, sourceHash, 2);
            }

            return createBlock(blockNumber, oldHash, HASH_A);
        }),
        transactionManager: manager,
    });

    await expect(worker.execute()).rejects.toThrow("Cannot find common ancestor for chain 10 from block 1");
});

test("sequencer service leaves cursor concurrency guard to conditional advance", async () => {
    const calls: string[] = [];
    const { manager } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);

    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            getForUpdate: async () => {
                calls.push("lock");
                return cursor;
            },
            advanceLastCommitted: async () => {
                calls.push("advance");
            },
        }),
        blocksRepository: createBlocksRepository(() => createBlock(41, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async () => {
                calls.push("mark-committed");
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual(["advance", "mark-committed"]);
});

test("sequencer service throws when fetched job changes before commit", async () => {
    const { manager, transaction } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);

    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository(() => createBlock(41, HASH_B, HASH_A)),
        blockJobsRepository: createBlockJobsRepository({
            get: async (_chainId, blockNumber, tx) => {
                if (tx === transaction) {
                    return createJob(blockNumber, "fetching");
                }

                return createJob(blockNumber, "fetched");
            },
        }),
        transactionManager: manager,
    });

    await expect(worker.execute()).rejects.toThrow("Fetched block job changed before commit for chain 10 block 41");
});

test("sequencer service throws when fetched block data changes before commit", async () => {
    const { manager, transaction } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const changedParentHash = asHash32("0x3333333333333333333333333333333333333333333333333333333333333333");

    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => cursor),
        blocksRepository: createBlocksRepository((_chainId, _blockNumber, tx) => {
            if (tx === transaction) {
                return createBlock(41, HASH_B, changedParentHash);
            }

            return createBlock(41, HASH_B, HASH_A);
        }),
        transactionManager: manager,
    });

    await expect(worker.execute()).rejects.toThrow("Fetched block data changed before commit for chain 10 block 41");
});

test("sequencer service clamps max blocks per tick to one", async () => {
    const committed: number[] = [];
    const { manager } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const hash41 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash42 = asHash32("0x2222222222222222222222222222222222222222222222222222222222222222");

    const worker = createService({
        config: { maxBlocksPerTick: 0 },
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            advanceLastCommitted: async (_chainId, _prevBlock, _prevHash, blockNumber, blockHash) => {
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
            },
        }),
        blocksRepository: createBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 41) {
                return createBlock(41, hash41, HASH_A, 1);
            }

            if (blockNumber === 42) {
                return createBlock(42, hash42, hash41, 2);
            }

            return null;
        }),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async (_chainId, blockNumber) => {
                committed.push(blockNumber);
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(committed).toEqual([41]);
});
