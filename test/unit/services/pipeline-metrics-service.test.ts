import { PipelineMetricsService } from "../../../src/services/pipeline-metrics-service.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { BlockJobMetrics, RawBlockMetrics } from "../../../src/interfaces/metrics.js";
import type {
    BlockJobsRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { ChainCursor, WorkerCursor } from "../../../src/interfaces/pipeline.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const NOW = new Date("2026-01-01T00:00:10.900Z");

beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
    jest.useRealTimers();
});

test("pipeline metrics service computes block and reaction lag", async () => {
    const findFirstMissingInRange = jest.fn(async () => 105);
    const service = new PipelineMetricsService(
        { chainId: 1, confirmations: 6 },
        createSource(120),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 110,
            lastCommittedBlock: 100,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:04.000Z"),
        }),
        createBlockJobsRepository({
            counts: {
                pending: 1,
                fetching: 2,
                fetched: 3,
                committed: 4,
                failed: 5,
            },
            oldestPendingBlock: 106,
            oldestFetchingBlock: 107,
            oldestFetchedBlock: 101,
            oldestFailedBlock: 108,
            oldestFetchingClaimedAt: new Date("2026-01-01T00:00:03.000Z"),
        }),
        createRawBlocksRepository(
            {
                maxFetchedBlock: 104,
                lastFetchedAt: new Date("2026-01-01T00:00:07.000Z"),
            },
            findFirstMissingInRange
        ),
        createCanonicalTransactionsRepository(15n),
        createCanonicalEventsRepository(20n),
        createWorkerCursorsRepository([
            {
                workerName: "event-worker",
                chainId: 1,
                streamType: "event",
                lastSeq: 17n,
                updatedAt: new Date("2026-01-01T00:00:01.000Z"),
            },
            {
                workerName: "tx-worker",
                chainId: 1,
                streamType: "tx",
                lastSeq: 10n,
                updatedAt: new Date("2026-01-01T00:00:02.000Z"),
            },
        ]),
    );

    const snapshot = await service.get();

    expect(findFirstMissingInRange).toHaveBeenCalledWith(1, 101, 110);
    expect(snapshot).toEqual(expect.objectContaining({
        chainId: 1,
        observedAt: NOW,
        latestBlock: 120,
        safeHeadBlock: 114,
        lastEnqueuedBlock: 110,
        lastFetchedBlock: 104,
        lastCommittedBlock: 100,
        firstMissingRawBlock: 105,
        secondsSinceLastFetch: 3,
        secondsSinceLastCommit: 6,
        lag: {
            headToLatestBlocks: 6,
            enqueueToSafeBlocks: 4,
            fetchToEnqueuedBlocks: 6,
            commitToFetchedBlocks: 4,
            commitToSafeBlocks: 14,
            commitToLatestBlocks: 20,
        },
    }));
    expect(snapshot.reactions).toEqual([
        expect.objectContaining({
            workerName: "event-worker",
            streamType: "event",
            maxSeq: 20n,
            lagSeq: 3n,
            secondsSinceLastProgress: 9,
        }),
        expect.objectContaining({
            workerName: "tx-worker",
            streamType: "tx",
            maxSeq: 15n,
            lagSeq: 5n,
            secondsSinceLastProgress: 8,
        }),
    ]);
});

test("pipeline metrics service maps empty state without raw gap scan", async () => {
    const findFirstMissingInRange = jest.fn(async () => 1);
    const service = new PipelineMetricsService(
        { chainId: 1, confirmations: 0 },
        createSource(10),
        createChainCursorRepository(null),
        createBlockJobsRepository(createEmptyBlockJobMetrics()),
        createRawBlocksRepository({ maxFetchedBlock: null, lastFetchedAt: null }, findFirstMissingInRange),
        createCanonicalTransactionsRepository(0n),
        createCanonicalEventsRepository(0n),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();

    expect(findFirstMissingInRange).not.toHaveBeenCalled();
    expect(snapshot).toEqual(expect.objectContaining({
        latestBlock: 10,
        safeHeadBlock: 10,
        lastEnqueuedBlock: null,
        lastFetchedBlock: null,
        lastCommittedBlock: null,
        firstMissingRawBlock: null,
        secondsSinceLastFetch: null,
        secondsSinceLastCommit: null,
        lag: {
            headToLatestBlocks: 0,
            enqueueToSafeBlocks: null,
            fetchToEnqueuedBlocks: null,
            commitToFetchedBlocks: null,
            commitToSafeBlocks: null,
            commitToLatestBlocks: null,
        },
        reactions: [],
    }));
});

test("pipeline metrics service keeps raw-dependent lag null when no raw block exists", async () => {
    const findFirstMissingInRange = jest.fn(async () => 51);
    const service = new PipelineMetricsService(
        { chainId: 1, confirmations: 3 },
        createSource(60),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 55,
            lastCommittedBlock: 50,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:10.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockJobMetrics()),
        createRawBlocksRepository({ maxFetchedBlock: null, lastFetchedAt: null }, findFirstMissingInRange),
        createCanonicalTransactionsRepository(0n),
        createCanonicalEventsRepository(0n),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();

    expect(findFirstMissingInRange).toHaveBeenCalledWith(1, 51, 55);
    expect(snapshot.lastFetchedBlock).toBeNull();
    expect(snapshot.secondsSinceLastFetch).toBeNull();
    expect(snapshot.lag).toEqual({
        headToLatestBlocks: 3,
        enqueueToSafeBlocks: 2,
        fetchToEnqueuedBlocks: null,
        commitToFetchedBlocks: null,
        commitToSafeBlocks: 7,
        commitToLatestBlocks: 10,
    });
});

test("pipeline metrics service maps null gap when committed block reaches enqueued block", async () => {
    const findFirstMissingInRange = jest.fn(async () => null);
    const service = new PipelineMetricsService(
        { chainId: 1, confirmations: 1 },
        createSource(11),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 10,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:10.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockJobMetrics()),
        createRawBlocksRepository(
            {
                maxFetchedBlock: 10,
                lastFetchedAt: new Date("2026-01-01T00:00:10.000Z"),
            },
            findFirstMissingInRange
        ),
        createCanonicalTransactionsRepository(0n),
        createCanonicalEventsRepository(0n),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();

    expect(findFirstMissingInRange).toHaveBeenCalledWith(1, 11, 10);
    expect(snapshot.firstMissingRawBlock).toBeNull();
    expect(snapshot.lag.commitToSafeBlocks).toBe(0);
});

test("pipeline metrics service clamps future timestamps to zero seconds", async () => {
    const service = new PipelineMetricsService(
        { chainId: 1, confirmations: 0 },
        createSource(10),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 9,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockJobMetrics()),
        createRawBlocksRepository(
            {
                maxFetchedBlock: 10,
                lastFetchedAt: new Date("2026-01-01T00:00:20.000Z"),
            },
            jest.fn(async () => null)
        ),
        createCanonicalTransactionsRepository(5n),
        createCanonicalEventsRepository(7n),
        createWorkerCursorsRepository([
            {
                workerName: "event-worker",
                chainId: 1,
                streamType: "event",
                lastSeq: 7n,
                updatedAt: new Date("2026-01-01T00:00:20.000Z"),
            },
            {
                workerName: "tx-worker",
                chainId: 1,
                streamType: "tx",
                lastSeq: 5n,
                updatedAt: new Date("2026-01-01T00:00:20.000Z"),
            },
        ]),
    );

    const snapshot = await service.get();

    expect(snapshot.secondsSinceLastFetch).toBe(0);
    expect(snapshot.secondsSinceLastCommit).toBe(0);
    expect(snapshot.reactions).toEqual([
        expect.objectContaining({
            workerName: "event-worker",
            lagSeq: 0n,
            secondsSinceLastProgress: 0,
        }),
        expect.objectContaining({
            workerName: "tx-worker",
            lagSeq: 0n,
            secondsSinceLastProgress: 0,
        }),
    ]);
});

function createSource(latestBlock: number): BlockSource {
    return {
        getLatestBlockNumber: async () => latestBlock,
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };
}

function createChainCursorRepository(cursor: ChainCursor | null): ChainCursorRepository {
    return {
        get: async () => cursor,
        getForUpdate: async () => cursor,
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async () => undefined,
    };
}

function createBlockJobsRepository(metrics: BlockJobMetrics): BlockJobsRepository {
    return {
        enqueueRange: async () => undefined,
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        getMetrics: async () => metrics,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createRawBlocksRepository(
    metrics: RawBlockMetrics,
    findFirstMissingInRange: RawBlocksRepository["findFirstMissingInRange"]
): RawBlocksRepository {
    return {
        save: async () => undefined,
        get: async () => null,
        getMetrics: async () => metrics,
        findFirstMissingInRange,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createCanonicalTransactionsRepository(maxSeq: bigint): CanonicalTransactionsRepository {
    return {
        readFromSeq: async () => [],
        maxSeq: async () => maxSeq,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createCanonicalEventsRepository(maxSeq: bigint): CanonicalEventsRepository {
    return {
        readFromSeq: async () => [],
        maxSeq: async () => maxSeq,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createWorkerCursorsRepository(cursors: WorkerCursor[]): WorkerCursorsRepository {
    return {
        get: async () => null,
        listByChain: async () => cursors,
        insert: async () => undefined,
        advance: async () => undefined,
    };
}

function createEmptyBlockJobMetrics(): BlockJobMetrics {
    return {
        counts: {
            pending: 0,
            fetching: 0,
            fetched: 0,
            committed: 0,
            failed: 0,
        },
        oldestPendingBlock: null,
        oldestFetchingBlock: null,
        oldestFetchedBlock: null,
        oldestFailedBlock: null,
        oldestFetchingClaimedAt: null,
    };
}
