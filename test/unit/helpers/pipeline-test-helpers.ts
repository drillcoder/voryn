import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type {
    PipelineBlock,
    PipelineEvent,
    PipelineTransaction,
    WorkerCursorPosition,
} from "../../../src/interfaces/pipeline.js";
import type {
    BlockJobsRepository,
    ChainCursorRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { TransactionManager } from "../../../src/interfaces/transaction-manager.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

export const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
export const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
export const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
export const DATA = asHexData("0x01");

export const createPipelineBlock = (
    overrides: Partial<PipelineBlock> = {},
): PipelineBlock => ({
    chainId: 7,
    blockNumber: 1,
    blockHash: HASH_A,
    parentHash: HASH_B,
    blockTimestamp: 1_700_000_001,
    fetchedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
});

export const createPipelineTransaction = (
    overrides: Partial<PipelineTransaction> = {},
): PipelineTransaction => ({
    chainId: 7,
    blockNumber: 1,
    blockHash: HASH_A,
    index: 0,
    hash: HASH_B,
    from: ADDRESS,
    to: null,
    value: "0",
    data: DATA,
    ...overrides,
});

export const createPipelineEvent = (
    overrides: Partial<PipelineEvent> = {},
): PipelineEvent => ({
    chainId: 7,
    blockNumber: 1,
    blockHash: HASH_A,
    transactionIndex: 0,
    transactionHash: HASH_B,
    index: 0,
    address: ADDRESS,
    topics: [HASH_A],
    data: DATA,
    ...overrides,
});

export const createWorkerCursorPosition = (
    overrides: Partial<WorkerCursorPosition> = {},
): WorkerCursorPosition => ({
    lastBlockNumber: 1,
    lastTransactionIndex: 0,
    ...overrides,
});

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
    deleteBlockNumberRange: async () => 0,
});

export const createNoopBlocksRepository = (): BlocksRepository => ({
    insert: async () => undefined,
    get: async () => null,
    getProgress: async () => null,
    getOldestBlockNumber: async () => null,
    deleteBlockNumberRange: async () => 0,
    deleteByBlockNumber: async () => 0,
});

export const createNoopChainCursorRepository = (): ChainCursorRepository => ({
    get: async () => null,
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

export const createNoopTransactionsRepository = (): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange: async () => 0,
    deleteByBlockNumber: async () => 0,
});

export const createNoopEventsRepository = (): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange: async () => 0,
    deleteByBlockNumber: async () => 0,
});

export const createNoopWorkerCursorsRepository = (): WorkerCursorsRepository => ({
    get: async () => null,
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
});
