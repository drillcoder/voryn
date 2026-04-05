import type { ChainId } from "../types/chain.js";

export interface HeadWorkerConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    confirmations: number;
    depthBlocks: number;
}

export interface FetchWorkerConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    fetchBatchSize: number;
    fetchClaimTtlMs: number;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
}

export interface SequencerWorkerConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
}

export interface RetentionWorkerConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    retentionDepthBlocks: number;
}

export interface ReactionWorkerConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    workerName: string;
    batchSize: number;
}
