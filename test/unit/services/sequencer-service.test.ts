import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { Logger } from "../../../src/interfaces/logger.js";
import type { ChainCursor, RawBlock } from "../../../src/interfaces/pipeline.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
} from "../../../src/interfaces/repositories.js";
import type { SequencerWorkerConfig } from "../../../src/interfaces/runtime.js";
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

const createRawBlock = (
    blockNumber: BlockNumber,
    blockHash: HashHex,
    parentHash: HashHex,
    timestamp = 1,
): RawBlock => ({
    chainId: 10,
    blockNumber,
    blockHash,
    parentHash,
    payload: {
        block: {
            chainId: 10,
            number: blockNumber,
            hash: blockHash,
            parentHash,
            timestamp,
            raw: {},
        },
        transactions: [],
        logs: [],
    },
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
        raw: {},
    },
    transactions: [],
    logs: [],
});

const createSource = (
    getBlockData: BlockSource["getBlockData"] = async () => createFetchedBlock(0, HASH_A, HASH_A),
): BlockSource => ({
    getLatestBlockNumber: async () => 0,
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

const createRawBlocksRepository = (
    getRaw: (_chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor) => RawBlock | null,
    overrides: Partial<RawBlocksRepository> = {},
): RawBlocksRepository => ({
    save: async () => undefined,
    get: async (chainId, blockNumber, transaction) => getRaw(chainId, blockNumber, transaction),
    getProgress: async () => ({
        block: null,
        updatedAt: null,
    }),
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

const createCanonicalBlocksRepository = (
    overrides: Partial<CanonicalBlocksRepository> = {},
): CanonicalBlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

const createCanonicalTransactionsRepository = (
    overrides: Partial<CanonicalTransactionsRepository> = {},
): CanonicalTransactionsRepository => ({
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

const createCanonicalEventsRepository = (
    overrides: Partial<CanonicalEventsRepository> = {},
): CanonicalEventsRepository => ({
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

const createBlockJobsRepository = (overrides: Partial<BlockJobsRepository> = {}): BlockJobsRepository => ({
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

const createService = (options: {
    source?: BlockSource;
    chainCursorRepository: ChainCursorRepository;
    rawBlocksRepository: RawBlocksRepository;
    canonicalBlocksRepository?: CanonicalBlocksRepository;
    canonicalTransactionsRepository?: CanonicalTransactionsRepository;
    canonicalEventsRepository?: CanonicalEventsRepository;
    blockJobsRepository?: BlockJobsRepository;
    transactionManager: TransactionManager;
    config?: Partial<SequencerWorkerConfig>;
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
    options.rawBlocksRepository,
    options.canonicalBlocksRepository ?? createCanonicalBlocksRepository(),
    options.canonicalTransactionsRepository ?? createCanonicalTransactionsRepository(),
    options.canonicalEventsRepository ?? createCanonicalEventsRepository(),
    options.blockJobsRepository ?? createBlockJobsRepository(),
    options.transactionManager,
    options.logger,
);

test("sequencer service commits next block", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const raw = createRawBlock(41, HASH_B, HASH_A);

    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            advanceLastCommitted: async (_chainId, _prevBlock, _prevHash, blockNumber, _blockHash, tx) => {
                calls.push(`advance:${String(blockNumber)}:${String(tx === transaction)}`);
            },
        }),
        rawBlocksRepository: createRawBlocksRepository(() => raw),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            insert: async () => {
                calls.push("insert-block");
            },
        }),
        canonicalTransactionsRepository: createCanonicalTransactionsRepository({
            insertMany: async () => {
                calls.push("insert-tx");
            },
        }),
        canonicalEventsRepository: createCanonicalEventsRepository({
            insertMany: async () => {
                calls.push("insert-event");
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async () => {
                calls.push("mark-committed");
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual(["insert-block", "insert-tx", "insert-event", "advance:41:true", "mark-committed"]);
});

test("sequencer service exits when cursor is missing", async () => {
    const { manager } = createPassThroughManager();
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => null),
        rawBlocksRepository: createRawBlocksRepository(() => null),
        transactionManager: manager,
    });

    await expect(worker.execute()).resolves.toBeUndefined();
});

test("sequencer service commits multiple blocks in one tick", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const cursor = createCursor(40, HASH_A, 50);
    const hash41 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash42 = asHash32("0x2222222222222222222222222222222222222222222222222222222222222222");

    const worker = createService({
        config: { maxBlocksPerTick: 2 },
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            advanceLastCommitted: async (_chainId, _prevBlock, _prevHash, blockNumber, blockHash, tx) => {
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
                calls.push(`advance:${String(blockNumber)}:${String(tx === transaction)}`);
            },
        }),
        rawBlocksRepository: createRawBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 41) {
                return createRawBlock(41, hash41, HASH_A, 1);
            }

            if (blockNumber === 42) {
                return createRawBlock(42, hash42, hash41, 2);
            }

            return null;
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            insert: async (block) => {
                calls.push(`insert-block:${String(block.number)}`);
            },
        }),
        canonicalTransactionsRepository: createCanonicalTransactionsRepository({
            insertMany: async (_chainId, blockNumber) => {
                calls.push(`insert-tx:${String(blockNumber)}`);
            },
        }),
        canonicalEventsRepository: createCanonicalEventsRepository({
            insertMany: async (_chainId, blockNumber) => {
                calls.push(`insert-event:${String(blockNumber)}`);
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            markCommitted: async (_chainId, blockNumber) => {
                calls.push(`mark-committed:${String(blockNumber)}`);
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([
        "insert-block:41",
        "insert-tx:41",
        "insert-event:41",
        "advance:41:true",
        "mark-committed:41",
        "insert-block:42",
        "insert-tx:42",
        "insert-event:42",
        "advance:42:true",
        "mark-committed:42",
    ]);
});

test("sequencer service exits when raw block is missing", async () => {
    const { manager } = createPassThroughManager();
    const worker = createService({
        chainCursorRepository: createChainCursorRepository(() => createCursor(9, HASH_A, 10)),
        rawBlocksRepository: createRawBlocksRepository(() => null),
        transactionManager: manager,
    });

    await expect(worker.execute()).resolves.toBeUndefined();
});

test("sequencer service rolls back to common ancestor on parent hash mismatch", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash11 = asHash32("0x1212121212121212121212121212121212121212121212121212121212121212");
    const cursor = createCursor(10, oldHash10, 11);

    const source = createSource(async (_chainId, blockNumber) => {
        if (blockNumber === 10) {
            return createFetchedBlock(10, newHash10, hash9, 10);
        }

        return createFetchedBlock(9, hash9, HASH_A, 9);
    });

    const worker = createService({
        source,
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            getForUpdate: async (_chainId, tx) => {
                calls.push(`lock:${String(tx === transaction)}`);
                return cursor;
            },
            setPositions: async (_chainId, blockNumber, blockHash, lastEnqueuedBlock, tx) => {
                calls.push(
                    `set-cursor:${String(blockNumber)}:${blockHash}:${String(lastEnqueuedBlock)}:`
                    + String(tx === transaction)
                );
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
                cursor.lastEnqueuedBlock = lastEnqueuedBlock;
            },
        }),
        rawBlocksRepository: createRawBlocksRepository(() => createRawBlock(11, hash11, newHash10, 11), {
            deleteAfterBlock: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-raw-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 2;
            },
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 10) {
                    return createFetchedBlock(10, oldHash10, hash9, 10).block;
                }

                return createFetchedBlock(9, hash9, HASH_A, 9).block;
            },
            deleteAfterBlock: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-blocks-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 1;
            },
        }),
        canonicalTransactionsRepository: createCanonicalTransactionsRepository({
            deleteAfterBlock: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-tx-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 1;
            },
        }),
        canonicalEventsRepository: createCanonicalEventsRepository({
            deleteAfterBlock: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-events-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 1;
            },
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlock: async (_chainId, blockNumber, tx) => {
                calls.push(`delete-jobs-after:${String(blockNumber)}:${String(tx === transaction)}`);
                return 2;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(cursor.lastCommittedBlock).toBe(9);
    expect(cursor.lastCommittedHash).toBe(hash9);
    expect(cursor.lastEnqueuedBlock).toBe(9);
    expect(calls).toContain("lock:true");
    expect(calls).toContain("delete-events-after:9:true");
    expect(calls).toContain("delete-tx-after:9:true");
    expect(calls).toContain("delete-blocks-after:9:true");
    expect(calls).toContain("delete-raw-after:9:true");
    expect(calls).toContain("delete-jobs-after:9:true");
});

test("sequencer service logs rollback metadata", async () => {
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);
    const warn = jest.fn();
    const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn,
        error: jest.fn(),
    };

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => {
            if (blockNumber === 10) {
                return createFetchedBlock(10, newHash10, hash9, 10);
            }

            return createFetchedBlock(9, hash9, HASH_A, 9);
        }),
        chainCursorRepository: createChainCursorRepository(() => cursor, {
            setPositions: async (_chainId, blockNumber, blockHash, lastEnqueuedBlock) => {
                cursor.lastCommittedBlock = blockNumber;
                cursor.lastCommittedHash = blockHash;
                cursor.lastEnqueuedBlock = lastEnqueuedBlock;
            },
        }),
        rawBlocksRepository: createRawBlocksRepository(() => createRawBlock(11, HASH_B, newHash10, 11), {
            deleteAfterBlock: async () => 2,
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 10) {
                    return createFetchedBlock(10, oldHash10, hash9, 10).block;
                }

                return createFetchedBlock(9, hash9, HASH_A, 9).block;
            },
            deleteAfterBlock: async () => 3,
        }),
        canonicalTransactionsRepository: createCanonicalTransactionsRepository({
            deleteAfterBlock: async () => 4,
        }),
        canonicalEventsRepository: createCanonicalEventsRepository({
            deleteAfterBlock: async () => 5,
        }),
        blockJobsRepository: createBlockJobsRepository({
            deleteAfterBlock: async () => 6,
        }),
        transactionManager: manager,
        logger,
    });

    await worker.execute();

    expect(warn).toHaveBeenCalledWith("sequencer_reorg_rollback", {
        chainId: 10,
        fromBlock: 10,
        ancestorBlock: 9,
        ancestorHash: hash9,
        deletedBlockJobs: 6,
        deletedRawBlocks: 2,
        deletedCanonicalBlocks: 3,
        deletedCanonicalTransactions: 4,
        deletedCanonicalEvents: 5,
    });
});

test("sequencer service skips rollback when cursor disappears during reorg transaction", async () => {
    const calls: string[] = [];
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

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
        rawBlocksRepository: createRawBlocksRepository(() => createRawBlock(11, HASH_B, newHash10, 11), {
            deleteAfterBlock: async () => {
                calls.push("delete-raw");
                return 1;
            },
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 10) {
                    return createFetchedBlock(10, oldHash10, hash9, 10).block;
                }

                return createFetchedBlock(9, hash9, HASH_A, 9).block;
            },
        }),
        transactionManager: manager,
        logger,
    });

    await worker.execute();

    expect(calls).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
});

test("sequencer service skips rollback when cursor changed during reorg transaction", async () => {
    const calls: string[] = [];
    const { manager } = createPassThroughManager();
    const hash9 = asHash32("0x0909090909090909090909090909090909090909090909090909090909090909");
    const oldHash10 = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const newHash10 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const cursor = createCursor(10, oldHash10, 11);
    const changedCursor = createCursor(11, HASH_B, 11);

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
        rawBlocksRepository: createRawBlocksRepository(() => createRawBlock(11, HASH_B, newHash10, 11), {
            deleteAfterBlock: async () => {
                calls.push("delete-raw");
                return 1;
            },
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 10) {
                    return createFetchedBlock(10, oldHash10, hash9, 10).block;
                }

                return createFetchedBlock(9, hash9, HASH_A, 9).block;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service skips rollback when raw block already matches current cursor", async () => {
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
        chainCursorRepository: createChainCursorRepository(() => cursor),
        rawBlocksRepository: createRawBlocksRepository((_chainId, _blockNumber, transaction) => {
            if (transaction === undefined) {
                return createRawBlock(11, HASH_B, newHash10, 11);
            }

            return createRawBlock(11, HASH_B, oldHash10, 11);
        }, {
            deleteAfterBlock: async () => {
                calls.push("delete-raw");
                return 1;
            },
        }),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 10) {
                    return createFetchedBlock(10, oldHash10, hash9, 10).block;
                }

                return createFetchedBlock(9, hash9, HASH_A, 9).block;
            },
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(calls).toEqual([]);
});

test("sequencer service throws when common ancestor cannot be found", async () => {
    const { manager } = createPassThroughManager();
    const oldHash = asHash32("0x1010101010101010101010101010101010101010101010101010101010101010");
    const sourceHash = asHash32("0x2020202020202020202020202020202020202020202020202020202020202020");
    const rawHash = asHash32("0x3030303030303030303030303030303030303030303030303030303030303030");
    const cursor = createCursor(1, oldHash, 2);

    const worker = createService({
        source: createSource(async (_chainId, blockNumber) => createFetchedBlock(blockNumber, sourceHash, HASH_A)),
        chainCursorRepository: createChainCursorRepository(() => cursor),
        rawBlocksRepository: createRawBlocksRepository(() => createRawBlock(2, rawHash, sourceHash, 2)),
        canonicalBlocksRepository: createCanonicalBlocksRepository({
            get: async (_chainId, blockNumber) => createFetchedBlock(blockNumber, oldHash, HASH_A).block,
        }),
        transactionManager: manager,
    });

    await expect(worker.execute()).rejects.toThrow("Cannot find common ancestor for chain 10 from block 1");
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
                committed.push(blockNumber);
            },
        }),
        rawBlocksRepository: createRawBlocksRepository((_chainId, blockNumber) => {
            if (blockNumber === 41) {
                return createRawBlock(41, hash41, HASH_A, 1);
            }

            if (blockNumber === 42) {
                return createRawBlock(42, hash42, hash41, 2);
            }

            return null;
        }),
        transactionManager: manager,
    });

    await worker.execute();

    expect(committed).toEqual([41]);
});
