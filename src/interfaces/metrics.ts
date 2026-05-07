import type { BlockNumber, ChainId } from "../types/chain.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";

export type BlockJobStatusCounts = Record<BlockJobStatus, number>;

export interface RawBlockProgress {
    block: BlockNumber | null;
    updatedAt: Date | null;
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
    secondsSinceProgress: number | null;
}

export interface PipelineStageMetrics {
    head: BlockStageMetrics;
    fetch: BlockStageMetrics;
    sequencer: BlockStageMetrics;
}

export interface ChainPipelineMetrics {
    chainId: ChainId;
    observedAt: Date;
    latestBlock: BlockNumber;
    stages: PipelineStageMetrics;
    blockStatusCounts: BlockJobStatusCounts;
    reactions: PipelineReactionMetrics[];
}

export interface PipelineMetricsConfig {
    chainId: ChainId;
}
