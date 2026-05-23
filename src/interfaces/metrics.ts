import type { BlockNumber, ChainId } from "../types/chain.js";
import type { EthersSourceChainConfig } from "./source-config.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";

export type BlockJobStatusCounts = Record<BlockJobStatus, number>;

export interface FailedBlockMetrics {
    block: BlockNumber;
    attempts: number;
    error: string | null;
    nextRetryAt: Date | null;
    updatedAt: Date;
}

export interface BlockDataProgress {
    block: BlockNumber;
    blockTimestamp: number;
    updatedAt: Date;
}

export interface PipelineReactionMetrics {
    workerName: string;
    streamType: StreamType;
    block: BlockNumber;
    lagBlocks: number | null;
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

export interface PipelineMetricsResult {
    observedAt: Date;
    chains: ChainPipelineMetrics[];
}

export interface PipelineMetricsConfig {
    chains: readonly EthersSourceChainConfig[];
}
