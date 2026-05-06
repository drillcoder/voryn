import type { BlockNumber, ChainId } from "../types/chain.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";

export type BlockJobStatusCounts = Record<BlockJobStatus, number>;

export interface BlockJobMetrics {
    counts: BlockJobStatusCounts;
    oldestPendingBlock: BlockNumber | null;
    oldestFetchingBlock: BlockNumber | null;
    oldestFetchedBlock: BlockNumber | null;
    oldestFailedBlock: BlockNumber | null;
    oldestFetchingClaimedAt: Date | null;
}

export interface RawBlockMetrics {
    maxFetchedBlock: BlockNumber | null;
    lastFetchedAt: Date | null;
}

export interface PipelineReactionMetrics {
    workerName: string;
    streamType: StreamType;
    lastSeq: bigint;
    maxSeq: bigint;
    lagSeq: bigint;
    updatedAt: Date;
    secondsSinceLastProgress: number;
}

export interface ChainPipelineLagMetrics {
    headToLatestBlocks: number;
    enqueueToSafeBlocks: number | null;
    fetchToEnqueuedBlocks: number | null;
    commitToFetchedBlocks: number | null;
    commitToSafeBlocks: number | null;
    commitToLatestBlocks: number | null;
}

export interface ChainPipelineMetrics {
    chainId: ChainId;
    observedAt: Date;
    latestBlock: BlockNumber;
    safeHeadBlock: BlockNumber;
    lastEnqueuedBlock: BlockNumber | null;
    lastFetchedBlock: BlockNumber | null;
    lastCommittedBlock: BlockNumber | null;
    firstMissingRawBlock: BlockNumber | null;
    secondsSinceLastFetch: number | null;
    secondsSinceLastCommit: number | null;
    lag: ChainPipelineLagMetrics;
    jobs: BlockJobMetrics;
    reactions: PipelineReactionMetrics[];
}

export interface PipelineMetricsConfig {
    chainId: ChainId;
    confirmations: number;
}
