import type { BlockSource } from "../interfaces/block-source.js";
import type {
    BlockStageMetrics,
    ChainPipelineMetrics,
    PipelineMetricsConfig,
    PipelineReactionMetrics,
} from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { StreamType } from "../types/pipeline.js";

const FAILED_BLOCKS_LIMIT = 25;

export class PipelineMetricsService {
    constructor(
        private readonly config: PipelineMetricsConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly canonicalTransactionsRepository: CanonicalTransactionsRepository,
        private readonly canonicalEventsRepository: CanonicalEventsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
    ) {
    }

    async get(): Promise<ChainPipelineMetrics> {
        const observedAt = new Date();
        const { chainId } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);
        const [cursor, blockStatusCounts, failedBlocks, rawProgress, workerCursors] = await Promise.all([
            this.chainCursorRepository.get(chainId),
            this.blockJobsRepository.getStatusCounts(chainId),
            this.blockJobsRepository.listFailedBlocks(chainId, FAILED_BLOCKS_LIMIT),
            this.rawBlocksRepository.getProgress(chainId),
            this.workerCursorsRepository.listByChain(chainId),
        ]);
        const reactions = await Promise.all(
            workerCursors.map(async (workerCursor): Promise<PipelineReactionMetrics> => {
                const targetSeq = await this.targetSeq(workerCursor.streamType);

                return {
                    workerName: workerCursor.workerName,
                    streamType: workerCursor.streamType,
                    processedSeq: workerCursor.lastSeq,
                    targetSeq,
                    lagSeq: targetSeq - workerCursor.lastSeq,
                    secondsSinceProgress: secondsBetween(observedAt, workerCursor.updatedAt),
                };
            })
        );
        const headBlock = cursor?.lastEnqueuedBlock ?? null;
        const sequencerBlock = cursor?.lastCommittedBlock ?? null;

        return {
            chainId,
            observedAt,
            latestBlock,
            stages: {
                head: createStage(latestBlock, headBlock),
                fetch: createStage(latestBlock, rawProgress.block),
                sequencer: createStage(latestBlock, sequencerBlock),
            },
            freshness: {
                secondsSincePipelineUpdate: cursor === null ? null : secondsBetween(observedAt, cursor.updatedAt),
                secondsSinceFetch: rawProgress.updatedAt === null
                    ? null
                    : secondsBetween(observedAt, rawProgress.updatedAt),
            },
            blockStatusCounts,
            failedBlocks,
            reactions,
        };
    }

    private async targetSeq(streamType: StreamType): Promise<bigint> {
        if (streamType === "event") {
            return this.canonicalEventsRepository.maxSeq(this.config.chainId);
        }

        return this.canonicalTransactionsRepository.maxSeq(this.config.chainId);
    }
}

function createStage(latestBlock: number, block: number | null): BlockStageMetrics {
    return {
        block,
        lagBlocks: block === null ? null : latestBlock - block,
    };
}

function secondsBetween(later: Date, earlier: Date): number {
    return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 1000));
}
