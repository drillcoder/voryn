import type { BlockSource } from "../interfaces/block-source.js";
import type { ChainPipelineMetrics, PipelineMetricsConfig, PipelineReactionMetrics } from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { StreamType } from "../types/pipeline.js";
import type { BlockNumber, ChainId } from "../types/chain.js";

const FAILED_BLOCKS_LIMIT = 25;

export class PipelineMetricsService {
    constructor(
        private readonly config: PipelineMetricsConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly canonicalBlocksRepository: CanonicalBlocksRepository,
        private readonly canonicalTransactionsRepository: CanonicalTransactionsRepository,
        private readonly canonicalEventsRepository: CanonicalEventsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
    ) {
    }

    async get(): Promise<ChainPipelineMetrics> {
        const observedAt = new Date();
        const { chainId } = this.config;
        const [cursor, blockStatusCounts, failedBlocks, rawProgress, workerCursors, latestBlock] = await Promise.all([
            this.chainCursorRepository.get(chainId),
            this.blockJobsRepository.getStatusCounts(chainId),
            this.blockJobsRepository.listFailedBlocks(chainId, FAILED_BLOCKS_LIMIT),
            this.rawBlocksRepository.getProgress(chainId),
            this.workerCursorsRepository.listByChain(chainId),
            this.source.getLatestBlock(chainId),
        ]);

        if (cursor === null) {
            throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
        }

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

        const latestBlockNumber = latestBlock.number;
        const latestBlockTimestamp = latestBlock.timestamp;

        const fetchBlockNumber = rawProgress?.block ?? null;
        const fetchBlockTimestamp = rawProgress?.blockTimestamp ?? null;
        const fetchLagBlocks = fetchBlockNumber === null ? null : latestBlockNumber - fetchBlockNumber;

        const sequencerBlockNumber = cursor.lastCommittedBlock;
        const sequencerBlockTimestamp = await this.getCanonicalBlockTimestamp(chainId, sequencerBlockNumber);
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
                secondsSinceFetch: rawProgress === null
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

    private async getCanonicalBlockTimestamp(chainId: ChainId, blockNumber: BlockNumber): Promise<number | null> {
        const block = await this.canonicalBlocksRepository.get(chainId, blockNumber);

        return block?.timestamp ?? null;
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
