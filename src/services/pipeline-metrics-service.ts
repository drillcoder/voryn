import type { BlockSource } from "../interfaces/block-source.js";
import type { ChainPipelineMetrics, PipelineMetricsConfig, PipelineReactionMetrics } from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { StreamType } from "../types/pipeline.js";

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
        const { chainId, confirmations } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);
        const safeHeadBlock = latestBlock - confirmations;
        const [cursor, jobs, raw, workerCursors] = await Promise.all([
            this.chainCursorRepository.get(chainId),
            this.blockJobsRepository.getMetrics(chainId),
            this.rawBlocksRepository.getMetrics(chainId),
            this.workerCursorsRepository.listByChain(chainId),
        ]);
        const firstMissingRawBlock = cursor === null
            ? null
            : await this.rawBlocksRepository.findFirstMissingInRange(
                chainId,
                cursor.lastCommittedBlock + 1,
                cursor.lastEnqueuedBlock,
            );
        const reactions = await Promise.all(
            workerCursors.map(async (workerCursor): Promise<PipelineReactionMetrics> => {
                const maxSeq = await this.maxSeq(workerCursor.streamType);

                return {
                    workerName: workerCursor.workerName,
                    streamType: workerCursor.streamType,
                    lastSeq: workerCursor.lastSeq,
                    maxSeq,
                    lagSeq: maxSeq - workerCursor.lastSeq,
                    updatedAt: workerCursor.updatedAt,
                    secondsSinceLastProgress: secondsBetween(observedAt, workerCursor.updatedAt),
                };
            })
        );

        return {
            chainId,
            observedAt,
            latestBlock,
            safeHeadBlock,
            lastEnqueuedBlock: cursor?.lastEnqueuedBlock ?? null,
            lastFetchedBlock: raw.maxFetchedBlock,
            lastCommittedBlock: cursor?.lastCommittedBlock ?? null,
            firstMissingRawBlock,
            secondsSinceLastFetch: raw.lastFetchedAt === null ? null : secondsBetween(observedAt, raw.lastFetchedAt),
            secondsSinceLastCommit: cursor === null ? null : secondsBetween(observedAt, cursor.updatedAt),
            lag: {
                headToLatestBlocks: confirmations,
                enqueueToSafeBlocks: cursor === null ? null : safeHeadBlock - cursor.lastEnqueuedBlock,
                fetchToEnqueuedBlocks: cursor === null || raw.maxFetchedBlock === null
                    ? null
                    : cursor.lastEnqueuedBlock - raw.maxFetchedBlock,
                commitToFetchedBlocks: cursor === null || raw.maxFetchedBlock === null
                    ? null
                    : raw.maxFetchedBlock - cursor.lastCommittedBlock,
                commitToSafeBlocks: cursor === null ? null : safeHeadBlock - cursor.lastCommittedBlock,
                commitToLatestBlocks: cursor === null ? null : latestBlock - cursor.lastCommittedBlock,
            },
            jobs,
            reactions,
        };
    }

    private async maxSeq(streamType: StreamType): Promise<bigint> {
        if (streamType === "event") {
            return this.canonicalEventsRepository.maxSeq(this.config.chainId);
        }

        return this.canonicalTransactionsRepository.maxSeq(this.config.chainId);
    }
}

function secondsBetween(later: Date, earlier: Date): number {
    return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 1000));
}
