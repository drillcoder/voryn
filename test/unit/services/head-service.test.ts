import type {
    BlockJobsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
} from "../../../src/interfaces/repositories.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import type { HeadWorkerConfig } from "../../../src/interfaces/runtime.js";
import { HeadService } from "../../../src/services/head-service.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const HASH_C = asHash32("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

const config: HeadWorkerConfig = {
    chainId: 1,
    confirmations: 2,
    delayBetweenTicksMs: 1000,
    depthBlocks: 5,
};

const createPassThroughManager = (): { manager: TransactionManager; transaction: DbExecutor } => {
    const transaction: DbExecutor = {
        query: async () => ({ rows: [], rowCount: 0 }),
    };

    return {
        transaction,
        manager: {
            run: async (callback) => callback(transaction),
        },
    };
};

const createRawBlocksRepository = (calls?: unknown[]): RawBlocksRepository => ({
    save: async () => undefined,
    get: async () => null,
    getProgress: async () => null,
    deleteUpToBlock: async (_chainId, toBlock, tx) => {
        calls?.push(["deleteRawUpToBlock", toBlock, tx]);
        return 0;
    },
    deleteAfterBlock: async () => 0,
});

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
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    ...overrides,
});

test("head service enqueues and updates cursor in transaction", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    const source: BlockSource = {
        getLatestBlockNumber: async () => 15,
        getLatestBlock: async () => {
            throw new Error("not used");
        },
        getBlock: async () => {
            throw new Error("not used");
        },
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 8,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        getForUpdate: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 8,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block, tx) => {
            calls.push(["setLastEnqueued", block, tx]);
        },
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const blockJobsRepository = createBlockJobsRepository({
        enqueueRange: async (_chainId, from, to, tx) => {
            calls.push(["enqueueRange", from, to, tx]);
        },
    });

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(),
        manager,
    );

    await worker.execute();

    expect(calls).toEqual([
        ["enqueueRange", 11, 13, transaction],
        ["setLastEnqueued", 13, transaction],
    ]);
});

test("head service starts enqueue range from zero when depth exceeds safe head", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    const source: BlockSource = {
        getLatestBlockNumber: async () => 3,
        getLatestBlock: async () => {
            throw new Error("not used");
        },
        getBlock: async () => {
            throw new Error("not used");
        },
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 0,
            lastCommittedBlock: 0,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        getForUpdate: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 0,
            lastCommittedBlock: 0,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block, tx) => {
            calls.push(["setLastEnqueued", block, tx]);
        },
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        createBlockJobsRepository({
            enqueueRange: async (_chainId, from, to, tx) => {
                calls.push(["enqueueRange", from, to, tx]);
            },
        }),
        createRawBlocksRepository(),
        manager,
    );

    await worker.execute();

    expect(calls).toEqual([
        ["enqueueRange", 1, 1, transaction],
        ["setLastEnqueued", 1, transaction],
    ]);
});

test("head service bootstraps missing cursor", async () => {
    const inserted: unknown[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getLatestBlock: async () => ({
            chainId: 1,
            number: 20,
            hash: HASH_A,
            parentHash: HASH_B,
            timestamp: 1,
            raw: {},
        }),
        getBlock: async () => ({ chainId: 1, number: 20, hash: HASH_A, parentHash: HASH_B, timestamp: 1, raw: {} }),
        getBlockData: async () => ({
            block: { chainId: 1, number: 20, hash: HASH_A, parentHash: HASH_B, timestamp: 1, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => null,
        getForUpdate: async () => { throw new Error("not used"); },
        insert: async (cursor) => {
            inserted.push(cursor);
        },
        setLastEnqueued: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const blockJobsRepository = createBlockJobsRepository({
        enqueueRange: async () => {
            throw new Error("must not enqueue during bootstrap");
        },
    });

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(),
        createPassThroughManager().manager,
    );

    await worker.execute();

    expect(inserted).toEqual([
        {
            chainId: 1,
            lastEnqueuedBlock: 20,
            lastCommittedBlock: 20,
            lastCommittedHash: HASH_A,
        },
    ]);
});

test("head service skips when cursor is already ahead of safe head", async () => {
    let enqueued = false;
    const worker = new HeadService(
        config,
        {
            getLatestBlockNumber: async () => 12,
            getLatestBlock: async () => {
                throw new Error("not used");
            },
            getBlock: async () => {
                throw new Error("not used");
            },
            getBlockData: async () => {
                throw new Error("not used");
            },
        },
        {
            get: async () => ({
                chainId: 1,
                lastEnqueuedBlock: 11,
                lastCommittedBlock: 10,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            }),
            getForUpdate: async () => ({
                chainId: 1,
                lastEnqueuedBlock: 11,
                lastCommittedBlock: 10,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            }),
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async () => undefined,
        },
        createBlockJobsRepository({
            enqueueRange: async () => {
                enqueued = true;
            },
        }),
        createRawBlocksRepository(),
        createPassThroughManager().manager,
    );

    await worker.execute();

    expect(enqueued).toBe(false);
});

test("head service rebases and enqueues new jobs when committed block is below floor", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    let getCalls = 0;
    let getForUpdateCalls = 0;
    const chainCursorRepository: ChainCursorRepository = {
        get: async () => {
            getCalls += 1;
            return {
                chainId: 1,
                lastEnqueuedBlock: 200,
                lastCommittedBlock: 90,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        getForUpdate: async (_chainId, tx) => {
            getForUpdateCalls += 1;
            expect(tx).toBe(transaction);
            return {
                chainId: 1,
                lastEnqueuedBlock: 200,
                lastCommittedBlock: 90,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block, tx) => {
            calls.push(["setLastEnqueued", block, tx]);
        },
        setPositions: async (_chainId, committed, committedHash, enqueued, tx) => {
            calls.push(["setPositions", committed, committedHash, enqueued, tx]);
        },
        advanceLastCommitted: async () => undefined,
    };

    const source: BlockSource = {
        getLatestBlockNumber: async () => 120,
        getLatestBlock: async () => ({
            chainId: 1,
            number: 120,
            hash: HASH_A,
            parentHash: HASH_B,
            timestamp: 1,
            raw: {},
        }),
        getBlock: async () => ({ chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} }),
        getBlockData: async (_chainId, blockNumber) => {
            expect(blockNumber).toBe(114);
            return {
                block: { chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
                transactions: [],
                logs: [],
            };
        },
    };

    const blockJobsRepository = createBlockJobsRepository({
        enqueueRange: async (_chainId, from, to, tx) => {
            calls.push(["enqueueRange", from, to, tx]);
        },
        deleteUpToBlock: async (_chainId, toBlock, tx) => {
            calls.push(["deleteJobsUpToBlock", toBlock, tx]);
            return 0;
        },
    });

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(calls),
        manager,
    );

    await worker.execute();

    expect(getCalls).toBe(1);
    expect(getForUpdateCalls).toBe(1);
    expect(calls).toEqual([
        ["setPositions", 113, HASH_C, 113, transaction],
        ["deleteJobsUpToBlock", 113, transaction],
        ["deleteRawUpToBlock", 113, transaction],
        ["enqueueRange", 114, 118, transaction],
        ["setLastEnqueued", 118, transaction],
    ]);
});

test("head service enqueues without rebase when cursor catches up before transactional check", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    let getCalls = 0;
    let getForUpdateCalls = 0;
    const chainCursorRepository: ChainCursorRepository = {
        get: async () => {
            getCalls += 1;
            return {
                chainId: 1,
                lastEnqueuedBlock: 200,
                lastCommittedBlock: 90,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        getForUpdate: async (_chainId, tx) => {
            getForUpdateCalls += 1;
            expect(tx).toBe(transaction);
            return {
                chainId: 1,
                lastEnqueuedBlock: 115,
                lastCommittedBlock: 113,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block, tx) => {
            calls.push(["setLastEnqueued", block, tx]);
        },
        setPositions: async () => {
            calls.push("setPositions");
        },
        advanceLastCommitted: async () => undefined,
    };

    const source: BlockSource = {
        getLatestBlockNumber: async () => 120,
        getLatestBlock: async () => ({
            chainId: 1,
            number: 120,
            hash: HASH_A,
            parentHash: HASH_B,
            timestamp: 1,
            raw: {},
        }),
        getBlock: async () => ({ chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} }),
        getBlockData: async () => ({
            block: { chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const blockJobsRepository = createBlockJobsRepository({
        enqueueRange: async (_chainId, from, to, tx) => {
            calls.push(["enqueueRange", from, to, tx]);
        },
        deleteUpToBlock: async () => {
            calls.push("deleteJobs");
            return 0;
        },
    });

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(calls),
        manager,
    );

    await worker.execute();

    expect(getCalls).toBe(1);
    expect(getForUpdateCalls).toBe(1);
    expect(calls).toEqual([
        ["enqueueRange", 116, 118, transaction],
        ["setLastEnqueued", 118, transaction],
    ]);
});

test("head service defers enqueue when locked cursor needs rebase", async () => {
    const calls: unknown[] = [];
    const { manager } = createPassThroughManager();

    const source: BlockSource = {
        getLatestBlockNumber: async () => 15,
        getLatestBlock: async () => {
            throw new Error("not used");
        },
        getBlock: async () => {
            throw new Error("not used");
        },
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 20,
            lastCommittedBlock: 8,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        getForUpdate: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 7,
            lastCommittedBlock: 7,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block) => {
            calls.push(["setLastEnqueued", block]);
        },
        setPositions: async () => {
            calls.push("setPositions");
        },
        advanceLastCommitted: async () => undefined,
    };

    const blockJobsRepository = createBlockJobsRepository({
        enqueueRange: async (_chainId, from, to) => {
            calls.push(["enqueueRange", from, to]);
        },
    });

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(calls),
        manager,
    );

    await worker.execute();

    expect(calls).toEqual([]);
});

test("head service throws when cursor disappears inside enqueue transaction", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 12,
        getLatestBlock: async () => {
            throw new Error("not used");
        },
        getBlock: async () => {
            throw new Error("not used");
        },
        getBlockData: async () => {
            throw new Error("not used");
        },
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async (_chainId, transaction) => {
            if (transaction) {
                return null;
            }
            return {
                chainId: 1,
                lastEnqueuedBlock: 10,
                lastCommittedBlock: 9,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        getForUpdate: async () => null,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        createBlockJobsRepository(),
        createRawBlocksRepository(),
        createPassThroughManager().manager,
    );

    await expect(worker.execute()).rejects.toThrow("Chain cursor not found for chain 1");
});

test("head service throws when cursor disappears inside rebase transaction", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 120,
        getLatestBlock: async () => ({
            chainId: 1,
            number: 120,
            hash: HASH_A,
            parentHash: HASH_B,
            timestamp: 1,
            raw: {},
        }),
        getBlock: async () => ({ chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} }),
        getBlockData: async () => ({
            block: { chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 1,
            lastEnqueuedBlock: 200,
            lastCommittedBlock: 90,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        getForUpdate: async () => null,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new HeadService(
        config,
        source,
        chainCursorRepository,
        createBlockJobsRepository(),
        createRawBlocksRepository(),
        createPassThroughManager().manager,
    );

    await expect(worker.execute()).rejects.toThrow("Chain cursor not found for chain 1");
});
