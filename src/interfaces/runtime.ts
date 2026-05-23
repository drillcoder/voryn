import type { ChainId } from "../types/chain.js";

export interface HeadWorkerOptions {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    confirmations: number;
    depthBlocks: number;
}

export interface FetchWorkerOptions {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    fetchBatchSize: number;
    fetchConcurrency: number;
    fetchClaimTtlMs: number;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
}

export interface SequencerWorkerOptions {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    maxBlocksPerTick: number;
}

export interface RetentionWorkerOptions {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    retentionDepthBlocks: number;
}

export interface ReactionWorkerOptions {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    workerName: string;
    batchSize: number;
    skipFlushInterval: number;
}
