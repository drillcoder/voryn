import type {
    BlockJobsRepository,
    BlockSource,
    ChainCursorRepository,
    DbExecutor,
    LeaderLock,
    TransactionManager,
} from "../../src/index.js";
import type { HeadWorkerConfig } from "../../src/interfaces/runtime.js";
import { HeadWorker } from "../../src/index.js";
import { asHash32 } from "../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const config: HeadWorkerConfig = {
    chainId: 1,
    confirmations: 2,
    pollIntervalMs: 1000,
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
            block: { chainId: 1, number: 20, hash: HASH_A, parentHash: HASH_A, timestamp: 1, raw: {} },
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
        createPassThroughManager().manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(enqueued).toBe(false);
});

test("head worker throws when cursor disappears inside transaction", async () => {
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
        createPassThroughManager().manager,
        leaderLock,
    );

    await expect(invokeTick(worker)).rejects.toThrow("Chain cursor not found for chain 1");
});
