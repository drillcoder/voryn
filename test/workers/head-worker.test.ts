import type {
    BlockJobsRepository,
    BlockSource,
    ChainCursorRepository,
    DbExecutor,
    LeaderLock,
    RawBlocksRepository,
    TransactionManager,
} from "../../src/index.js";
import type { HeadWorkerConfig } from "../../src/interfaces/runtime.js";
import { HeadWorker } from "../../src/index.js";
import { asHash32 } from "../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const HASH_C = asHash32("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const config: HeadWorkerConfig = {
    chainId: 1,
    confirmations: 2,
    pollIntervalMs: 1000,
    depthBlocks: 5,
};

const leaderLock: LeaderLock = { tryAcquire: async () => true, release: async () => undefined };

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
    deleteUpToBlock: async (_chainId, toBlock, tx) => {
        calls?.push(["deleteRawUpToBlock", toBlock, tx]);
        return 0;
    },
});

test("head worker enqueues and updates cursor in transaction", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    const source: BlockSource = {
        getLatestBlockNumber: async () => 15,
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
        insert: async () => undefined,
        setLastEnqueued: async (_chainId, block, tx) => {
            calls.push(["setLastEnqueued", block, tx]);
        },
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const blockJobsRepository: BlockJobsRepository = {
        enqueueRange: async (_chainId, from, to, tx) => {
            calls.push(["enqueueRange", from, to, tx]);
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        deleteUpToBlock: async () => 0,
    };

    const worker = new HeadWorker(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(),
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(calls).toEqual([
        ["enqueueRange", 11, 13, transaction],
        ["setLastEnqueued", 13, transaction],
    ]);
});

test("head worker bootstraps missing cursor", async () => {
    const inserted: unknown[] = [];

    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getBlockData: async () => ({
            block: { chainId: 1, number: 20, hash: HASH_A, parentHash: HASH_B, timestamp: 1, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => null,
        insert: async (cursor) => {
            inserted.push(cursor);
        },
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const blockJobsRepository: BlockJobsRepository = {
        enqueueRange: async () => {
            throw new Error("must not enqueue during bootstrap");
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        deleteUpToBlock: async () => 0,
    };

    const worker = new HeadWorker(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(),
        createPassThroughManager().manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(inserted).toEqual([
        {
            chainId: 1,
            lastEnqueuedBlock: 20,
            lastCommittedBlock: 20,
            lastCommittedHash: HASH_A,
        },
    ]);
});

test("head worker skips when cursor is already ahead of safe head", async () => {
    let enqueued = false;
    const worker = new HeadWorker(
        config,
        {
            getLatestBlockNumber: async () => 12,
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
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setLastCommitted: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async () => undefined,
        },
        {
            enqueueRange: async () => {
                enqueued = true;
            },
            claimForFetch: async () => null,
            markFetched: async () => undefined,
            markFetchFailed: async () => undefined,
            markCommitted: async () => undefined,
            deleteUpToBlock: async () => 0,
        },
        createRawBlocksRepository(),
        createPassThroughManager().manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(enqueued).toBe(false);
});

test("head worker rebases and trims old jobs when committed block is below floor", async () => {
    const calls: unknown[] = [];
    const { manager, transaction } = createPassThroughManager();

    let getCalls = 0;
    const chainCursorRepository: ChainCursorRepository = {
        get: async (_chainId, tx) => {
            getCalls += 1;
            if (tx === undefined) {
                return {
                    chainId: 1,
                    lastEnqueuedBlock: 200,
                    lastCommittedBlock: 90,
                    lastCommittedHash: HASH_A,
                    updatedAt: new Date(),
                };
            }

            return {
                chainId: 1,
                lastEnqueuedBlock: 200,
                lastCommittedBlock: 90,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        insert: async () => undefined,
        setLastEnqueued: async () => {
            throw new Error("must not set enqueued in rebase branch");
        },
        setLastCommitted: async () => undefined,
        setPositions: async (_chainId, committed, committedHash, enqueued, tx) => {
            calls.push(["setPositions", committed, committedHash, enqueued, tx]);
        },
        advanceLastCommitted: async () => undefined,
    };

    const source: BlockSource = {
        getLatestBlockNumber: async () => 120,
        getBlockData: async (_chainId, blockNumber) => {
            expect(blockNumber).toBe(114);
            return {
                block: { chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
                transactions: [],
                logs: [],
            };
        },
    };

    const blockJobsRepository: BlockJobsRepository = {
        enqueueRange: async () => {
            throw new Error("must not enqueue during rebase tick");
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        deleteUpToBlock: async (_chainId, toBlock, tx) => {
            calls.push(["deleteJobsUpToBlock", toBlock, tx]);
            return 0;
        },
    };

    const worker = new HeadWorker(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(calls),
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(getCalls).toBe(2);
    expect(calls).toEqual([
        ["setPositions", 113, HASH_C, 113, transaction],
        ["deleteJobsUpToBlock", 113, transaction],
        ["deleteRawUpToBlock", 113, transaction],
    ]);
});

test("head worker does not rebase when cursor catches up before transactional check", async () => {
    const calls: unknown[] = [];
    const { manager } = createPassThroughManager();

    let getCalls = 0;
    const chainCursorRepository: ChainCursorRepository = {
        get: async (_chainId, tx) => {
            getCalls += 1;
            if (tx === undefined) {
                return {
                    chainId: 1,
                    lastEnqueuedBlock: 200,
                    lastCommittedBlock: 90,
                    lastCommittedHash: HASH_A,
                    updatedAt: new Date(),
                };
            }

            return {
                chainId: 1,
                lastEnqueuedBlock: 200,
                lastCommittedBlock: 113,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            };
        },
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => {
            calls.push("setPositions");
        },
        advanceLastCommitted: async () => undefined,
    };

    const source: BlockSource = {
        getLatestBlockNumber: async () => 120,
        getBlockData: async () => ({
            block: { chainId: 1, number: 114, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
            transactions: [],
            logs: [],
        }),
    };

    const blockJobsRepository: BlockJobsRepository = {
        enqueueRange: async () => {
            throw new Error("must not enqueue in this tick");
        },
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        deleteUpToBlock: async () => {
            calls.push("deleteJobs");
            return 0;
        },
    };

    const worker = new HeadWorker(
        config,
        source,
        chainCursorRepository,
        blockJobsRepository,
        createRawBlocksRepository(calls),
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(getCalls).toBe(2);
    expect(calls).toEqual([]);
});

test("head worker throws when cursor disappears inside enqueue transaction", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 12,
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
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };

    const worker = new HeadWorker(
        config,
        source,
        chainCursorRepository,
        {
            enqueueRange: async () => undefined,
            claimForFetch: async () => null,
            markFetched: async () => undefined,
            markFetchFailed: async () => undefined,
            markCommitted: async () => undefined,
            deleteUpToBlock: async () => 0,
        },
        createRawBlocksRepository(),
        createPassThroughManager().manager,
        leaderLock,
    );

    await expect(invokeTick(worker)).rejects.toThrow("Chain cursor not found for chain 1");
});
