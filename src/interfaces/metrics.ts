import type { BlockNumber, ChainId } from "../types/chain.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";

export type BlockJobStatusCounts = Record<BlockJobStatus, number>;

export interface FailedBlockMetrics {
    block: BlockNumber;
    attempts: number;
    error: string | null;
    nextRetryAt: Date | null;
    updatedAt: Date;
}

export interface RawBlockProgress {
    block: BlockNumber;
    blockTimestamp: number;
    updatedAt: Date;
}

export interface PipelineReactionMetrics {
    workerName: string;
    streamType: StreamType;
    processedSeq: bigint;
    targetSeq: bigint;
    lagSeq: bigint;
    secondsSinceProgress: number;
}

export interface BlockStageMetrics {
    block: BlockNumber | null;
    lagBlocks: number | null;
}

export interface PipelineMaxLagMetrics {
    blocks: number | null;
    seconds: number | null;
}

export interface PipelineStageMetrics {
    head: BlockStageMetrics;
    fetch: BlockStageMetrics;
    sequencer: BlockStageMetrics;
}

export interface PipelineFreshnessMetrics {
    secondsSincePipelineUpdate: number | null;
    secondsSinceFetch: number | null;
}

export interface ChainPipelineMetrics {
    chainId: ChainId;
    observedAt: Date;
    latestBlock: BlockNumber;
    stages: PipelineStageMetrics;
    maxLag: PipelineMaxLagMetrics;
    freshness: PipelineFreshnessMetrics;
    blockStatusCounts: BlockJobStatusCounts;
    failedBlocks: FailedBlockMetrics[];
    reactions: PipelineReactionMetrics[];
}

export interface PipelineMetricsConfig {
    chainId: ChainId;
}
