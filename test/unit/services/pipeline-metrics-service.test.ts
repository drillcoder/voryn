import { PipelineMetricsService } from "../../../src/services/pipeline-metrics-service.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { BlockJobStatusCounts, FailedBlockMetrics, RawBlockProgress } from "../../../src/interfaces/metrics.js";
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

test("pipeline metrics service maps pipeline stages and reactions", async () => {
    const service = new PipelineMetricsService(
        { chainId: 1 },
        createSource(120),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 110,
            lastCommittedBlock: 100,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:04.000Z"),
        }),
        createBlockJobsRepository(
            {
                pending: 1,
                fetching: 2,
                fetched: 3,
                committed: 4,
                failed: 5,
            },
            [{
                block: 101,
                attempts: 4,
                error: "rpc timeout",
                nextRetryAt: new Date("2026-01-01T00:00:30.000Z"),
                updatedAt: new Date("2026-01-01T00:00:03.000Z"),
            }]
        ),
        createRawBlocksRepository({
            block: 104,
            updatedAt: new Date("2026-01-01T00:00:07.000Z"),
        }),
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

    expect(snapshot).toEqual({
        chainId: 1,
        observedAt: NOW,
        latestBlock: 120,
        stages: {
            head: {
                block: 110,
                lagBlocks: 10,
            },
            fetch: {
                block: 104,
                lagBlocks: 16,
            },
            sequencer: {
                block: 100,
                lagBlocks: 20,
            },
        },
        freshness: {
            secondsSincePipelineUpdate: 6,
            secondsSinceFetch: 3,
        },
        blockStatusCounts: {
            pending: 1,
            fetching: 2,
            fetched: 3,
            committed: 4,
            failed: 5,
        },
        failedBlocks: [{
            block: 101,
            attempts: 4,
            error: "rpc timeout",
            nextRetryAt: new Date("2026-01-01T00:00:30.000Z"),
            updatedAt: new Date("2026-01-01T00:00:03.000Z"),
        }],
        reactions: [
            {
                workerName: "event-worker",
                streamType: "event",
                processedSeq: 17n,
                targetSeq: 20n,
                lagSeq: 3n,
                secondsSinceProgress: 9,
            },
            {
                workerName: "tx-worker",
                streamType: "tx",
                processedSeq: 10n,
                targetSeq: 15n,
                lagSeq: 5n,
                secondsSinceProgress: 8,
            },
        ],
    });
});

test("pipeline metrics service maps empty state", async () => {
    const service = new PipelineMetricsService(
        { chainId: 1 },
        createSource(10),
        createChainCursorRepository(null),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createRawBlocksRepository({ block: null, updatedAt: null }),
        createCanonicalTransactionsRepository(0n),
        createCanonicalEventsRepository(0n),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();

    expect(snapshot).toEqual(expect.objectContaining({
        latestBlock: 10,
        stages: {
            head: {
                block: null,
                lagBlocks: null,
            },
            fetch: {
                block: null,
                lagBlocks: null,
            },
            sequencer: {
                block: null,
                lagBlocks: null,
            },
        },
        freshness: {
            secondsSincePipelineUpdate: null,
            secondsSinceFetch: null,
        },
        blockStatusCounts: createEmptyBlockStatusCounts(),
        failedBlocks: [],
        reactions: [],
    }));
});

test("pipeline metrics service keeps fetch progress null when no raw block exists", async () => {
    const service = new PipelineMetricsService(
        { chainId: 1 },
        createSource(60),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 55,
            lastCommittedBlock: 50,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:10.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createRawBlocksRepository({ block: null, updatedAt: null }),
        createCanonicalTransactionsRepository(0n),
        createCanonicalEventsRepository(0n),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();

    expect(snapshot.stages).toEqual({
        head: {
            block: 55,
            lagBlocks: 5,
        },
        fetch: {
            block: null,
            lagBlocks: null,
        },
        sequencer: {
            block: 50,
            lagBlocks: 10,
        },
    });
    expect(snapshot.freshness).toEqual({
        secondsSincePipelineUpdate: 0,
        secondsSinceFetch: null,
    });
});

test("pipeline metrics service clamps future freshness and reaction timestamps to zero seconds", async () => {
    const service = new PipelineMetricsService(
        { chainId: 1 },
        createSource(10),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 9,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createRawBlocksRepository({
            block: 10,
            updatedAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
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

    expect(snapshot.freshness).toEqual({
        secondsSincePipelineUpdate: 0,
        secondsSinceFetch: 0,
    });
    expect(snapshot.reactions).toEqual([
        expect.objectContaining({
            workerName: "event-worker",
            lagSeq: 0n,
            secondsSinceProgress: 0,
        }),
        expect.objectContaining({
            workerName: "tx-worker",
            lagSeq: 0n,
            secondsSinceProgress: 0,
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

function createBlockJobsRepository(
    counts: BlockJobStatusCounts,
    failedBlocks: FailedBlockMetrics[] = []
): BlockJobsRepository {
    return {
        enqueueRange: async () => undefined,
        get: async () => null,
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => undefined,
        getStatusCounts: async () => counts,
        listFailedBlocks: async (_chainId, limit) => failedBlocks.slice(0, limit),
        retryFailed: async () => 0,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createRawBlocksRepository(progress: RawBlockProgress): RawBlocksRepository {
    return {
        save: async () => undefined,
        get: async () => null,
        getProgress: async () => progress,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createCanonicalTransactionsRepository(targetSeq: bigint): CanonicalTransactionsRepository {
    return {
        readFromSeq: async () => [],
        maxSeq: async () => targetSeq,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
        deleteAfterBlock: async () => 0,
    };
}

function createCanonicalEventsRepository(targetSeq: bigint): CanonicalEventsRepository {
    return {
        readFromSeq: async () => [],
        maxSeq: async () => targetSeq,
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

function createEmptyBlockStatusCounts(): BlockJobStatusCounts {
    return {
        pending: 0,
        fetching: 0,
        fetched: 0,
        committed: 0,
        failed: 0,
    };
}
