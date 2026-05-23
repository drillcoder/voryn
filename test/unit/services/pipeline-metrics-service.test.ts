import { PipelineMetricsService } from "../../../src/services/pipeline-metrics-service.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { BlockDataProgress, BlockJobStatusCounts, FailedBlockMetrics } from "../../../src/interfaces/metrics.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { ChainCursor, PipelineBlock, WorkerCursor } from "../../../src/interfaces/pipeline.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const NOW = new Date("2026-01-01T00:00:10.900Z");

beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
    jest.useRealTimers();
});

test("pipeline metrics service maps pipeline stages and reaction block lag", async () => {
    const service = new PipelineMetricsService(
        { chains: [{ chainId: 1, rpcUrl: "http://127.0.0.1:8545" }] },
        createSource(120, 300),
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
        createBlocksRepository({
            progress: {
                block: 104,
                blockTimestamp: 240,
                updatedAt: new Date("2026-01-01T00:00:07.000Z"),
            },
            blockTimestamps: {
                100: 220,
            },
        }),
        createWorkerCursorsRepository([
            {
                workerName: "event-worker",
                chainId: 1,
                streamType: "event",
                position: {
                    lastBlockNumber: 97,
                    lastTransactionIndex: 4,
                    lastLogIndex: 9,
                },
                updatedAt: new Date("2026-01-01T00:00:01.000Z"),
            },
            {
                workerName: "transaction-worker",
                chainId: 1,
                streamType: "transaction",
                position: {
                    lastBlockNumber: 95,
                    lastTransactionIndex: 2,
                    lastLogIndex: null,
                },
                updatedAt: new Date("2026-01-01T00:00:02.000Z"),
            },
        ]),
    );

    const snapshot = await service.get();

    expect(snapshot).toEqual({
        observedAt: NOW,
        chains: [{
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
            maxLag: {
                blocks: 20,
                seconds: 80,
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
                    block: 97,
                    lagBlocks: 3,
                    secondsSinceProgress: 9,
                },
                {
                    workerName: "transaction-worker",
                    streamType: "transaction",
                    block: 95,
                    lagBlocks: 5,
                    secondsSinceProgress: 8,
                },
            ],
        }],
    });
});

test("pipeline metrics service throws when chain cursor is missing", async () => {
    const service = new PipelineMetricsService(
        { chains: [{ chainId: 1, rpcUrl: "http://127.0.0.1:8545" }] },
        createSource(10),
        createChainCursorRepository(null),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createBlocksRepository({ progress: null }),
        createWorkerCursorsRepository([]),
    );

    await expect(service.get()).rejects.toThrow("Chain cursor not found for chain 1");
});

test("pipeline metrics service keeps fetch progress null when no block data exists", async () => {
    const service = new PipelineMetricsService(
        { chains: [{ chainId: 1, rpcUrl: "http://127.0.0.1:8545" }] },
        createSource(60),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 55,
            lastCommittedBlock: 50,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:10.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createBlocksRepository({
            progress: null,
            blockTimestamps: {
                50: 500,
            },
        }),
        createWorkerCursorsRepository([]),
    );

    const snapshot = await service.get();
    const [chainMetrics] = snapshot.chains;

    expect(chainMetrics.stages).toEqual({
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
    expect(chainMetrics.freshness).toEqual({
        secondsSincePipelineUpdate: 0,
        secondsSinceFetch: null,
    });
    expect(chainMetrics.maxLag).toEqual({
        blocks: 10,
        seconds: 100,
    });
});

test("pipeline metrics service clamps future freshness and reaction timestamps to zero seconds", async () => {
    const service = new PipelineMetricsService(
        { chains: [{ chainId: 1, rpcUrl: "http://127.0.0.1:8545" }] },
        createSource(10),
        createChainCursorRepository({
            chainId: 1,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 9,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
        createBlockJobsRepository(createEmptyBlockStatusCounts()),
        createBlocksRepository({
            progress: {
                block: 10,
                blockTimestamp: 100,
                updatedAt: new Date("2026-01-01T00:00:20.000Z"),
            },
            blockTimestamps: {
                9: 90,
            },
        }),
        createWorkerCursorsRepository([
            {
                workerName: "event-worker",
                chainId: 1,
                streamType: "event",
                position: {
                    lastBlockNumber: 10,
                    lastTransactionIndex: 0,
                    lastLogIndex: 0,
                },
                updatedAt: new Date("2026-01-01T00:00:20.000Z"),
            },
        ]),
    );

    const snapshot = await service.get();
    const [chainMetrics] = snapshot.chains;

    expect(chainMetrics.freshness).toEqual({
        secondsSincePipelineUpdate: 0,
        secondsSinceFetch: 0,
    });
    expect(chainMetrics.reactions).toEqual([
        expect.objectContaining({
            workerName: "event-worker",
            lagBlocks: 0,
            secondsSinceProgress: 0,
        }),
    ]);
});

function createSource(latestBlock: number, latestBlockTimestamp = latestBlock * 10): BlockSource {
    return {
        getLatestBlockNumber: async () => latestBlock,
        getLatestBlock: async () => ({
            chainId: 1,
            number: latestBlock,
            hash: HASH,
            parentHash: HASH,
            timestamp: latestBlockTimestamp,
        }),
        getBlock: async () => ({
            chainId: 1,
            number: latestBlock,
            hash: HASH,
            parentHash: HASH,
            timestamp: latestBlockTimestamp,
        }),
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
        deleteAtOrBeforeBlockNumber: async () => 0,
        deleteAfterBlockNumber: async () => 0,
    };
}

function createBlocksRepository(options: {
    progress: BlockDataProgress | null;
    blockTimestamps?: Partial<Record<number, number>>;
}): BlocksRepository {
    return {
        insert: async () => undefined,
        get: async (_chainId, blockNumber) => {
            const timestamp = options.blockTimestamps?.[blockNumber];

            if (timestamp === undefined) {
                return null;
            }

            return createBlock(blockNumber, timestamp);
        },
        getProgress: async () => options.progress,
        deleteAtOrBeforeBlockNumber: async () => 0,
        deleteByBlockNumber: async () => 0,
        deleteAfterBlockNumber: async () => 0,
    };
}

function createBlock(blockNumber: number, blockTimestamp: number): PipelineBlock {
    return {
        chainId: 1,
        blockNumber,
        blockHash: HASH,
        parentHash: HASH,
        blockTimestamp,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
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
