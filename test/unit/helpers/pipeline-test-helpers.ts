import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

export const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
export const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
export const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
export const DATA = asHexData("0x01");

export const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

export const invokeStartLogMeta = (worker: object): Record<string, unknown> => (
    worker as { buildStartLogMeta: () => Record<string, unknown> }
).buildStartLogMeta();

export const leaderLock: LeaderLock = {
    tryAcquire: async () => true,
    release: async () => undefined,
};

export const transactionManager: TransactionManager = {
    run: async (callback) => {
        const tx: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
        return callback(tx);
    },
};

export const createNoopBlockJobsRepository = (): BlockJobsRepository => ({
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
    listFailedBlocks: async () => [],
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
});

export const createNoopRawBlocksRepository = (): RawBlocksRepository => ({
    save: async () => undefined,
    get: async () => null,
    getProgress: async () => ({
        block: null,
        updatedAt: null,
    }),
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
});

export const createNoopChainCursorRepository = (): ChainCursorRepository => ({
    get: async () => null,
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

export const createNoopCanonicalBlocksRepository = (): CanonicalBlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
});

export const createNoopCanonicalTransactionsRepository = (): CanonicalTransactionsRepository => ({
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
});

export const createNoopCanonicalEventsRepository = (): CanonicalEventsRepository => ({
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
});

export const createNoopWorkerCursorsRepository = (): WorkerCursorsRepository => ({
    get: async () => null,
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
});
