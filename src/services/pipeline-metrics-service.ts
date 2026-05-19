import type { BlockSource } from "../interfaces/block-source.js";
import type { ChainPipelineMetrics, PipelineMetricsConfig, PipelineReactionMetrics } from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";

const FAILED_BLOCKS_LIMIT = 25;

export class PipelineMetricsService {
    constructor(
        private readonly config: PipelineMetricsConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly blocksRepository: BlocksRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
    ) {
    }

    async get(): Promise<ChainPipelineMetrics> {
        const observedAt = new Date();
        const { chainId } = this.config;
        const [cursor, blockStatusCounts, failedBlocks, blockProgress, workerCursors, latestBlock] = await Promise.all([
            this.chainCursorRepository.get(chainId),
            this.blockJobsRepository.getStatusCounts(chainId),
            this.blockJobsRepository.listFailedBlocks(chainId, FAILED_BLOCKS_LIMIT),
            this.blocksRepository.getProgress(chainId),
            this.workerCursorsRepository.listByChain(chainId),
            this.source.getLatestBlock(chainId),
        ]);

        if (cursor === null) {
            throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
        }

        const reactions = workerCursors.map((workerCursor): PipelineReactionMetrics => ({
            workerName: workerCursor.workerName,
            streamType: workerCursor.streamType,
            block: workerCursor.position.lastBlockNumber,
            lagBlocks: Math.max(0, cursor.lastCommittedBlock - workerCursor.position.lastBlockNumber),
            secondsSinceProgress: secondsBetween(observedAt, workerCursor.updatedAt),
        }));

        const latestBlockNumber = latestBlock.number;
        const latestBlockTimestamp = latestBlock.timestamp;

        const fetchBlockNumber = blockProgress?.block ?? null;
        const fetchBlockTimestamp = blockProgress?.blockTimestamp ?? null;
        const fetchLagBlocks = fetchBlockNumber === null ? null : latestBlockNumber - fetchBlockNumber;

        const sequencerBlockNumber = cursor.lastCommittedBlock;
        const sequencerBlock = await this.blocksRepository.get(chainId, sequencerBlockNumber);
        const sequencerBlockTimestamp = sequencerBlock?.blockTimestamp ?? null;
        const sequencerLagBlocks = latestBlockNumber - sequencerBlockNumber;

        return {
            chainId,
            observedAt,
            latestBlock: latestBlockNumber,
            stages: {
                head: {
                    block: cursor.lastEnqueuedBlock,
                    lagBlocks: latestBlockNumber - cursor.lastEnqueuedBlock,
                },
                fetch: {
                    block: fetchBlockNumber,
                    lagBlocks: fetchLagBlocks,
                },
                sequencer: {
                    block: sequencerBlockNumber,
                    lagBlocks: sequencerLagBlocks,
                },
            },
            maxLag: {
                blocks: maxNullable([fetchLagBlocks, sequencerLagBlocks]),
                seconds: maxNullable([
                    lagSeconds(latestBlockTimestamp, fetchBlockTimestamp),
                    lagSeconds(latestBlockTimestamp, sequencerBlockTimestamp),
                ]),
            },
            freshness: {
                secondsSincePipelineUpdate: secondsBetween(observedAt, cursor.updatedAt),
                secondsSinceFetch: blockProgress === null
                    ? null
                    : secondsBetween(observedAt, blockProgress.updatedAt),
            },
            blockStatusCounts,
            failedBlocks,
            reactions,
        };
    }
}

function secondsBetween(later: Date, earlier: Date): number {
    return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 1000));
}

function lagSeconds(latestBlockTimestamp: number, stageBlockTimestamp: number | null): number | null {
    return stageBlockTimestamp === null ? null : Math.max(0, latestBlockTimestamp - stageBlockTimestamp);
}

function maxNullable(values: (number | null)[]): number | null {
    const knownValues = values.filter((value): value is number => value !== null);

    return knownValues.length === 0 ? null : Math.max(...knownValues);
}
