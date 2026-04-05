import type { ChainId } from "../types/chain.js";

export interface HeadWorkerConfig {
    chainId: ChainId;
    pollIntervalMs: number;
    confirmations: number;
    depthBlocks: number;
}

export interface FetchWorkerConfig {
    chainId: ChainId;
    pollIntervalMs: number;
    fetchBatchSize: number;
    fetchClaimTtlMs: number;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
}

export interface SequencerWorkerConfig {
    chainId: ChainId;
    pollIntervalMs: number;
}

export interface RetentionWorkerConfig {
    chainId: ChainId;
    pollIntervalMs: number;
    retentionDepthBlocks: number;
}

export interface ReactionWorkerConfig {
    chainId: ChainId;
    pollIntervalMs: number;
    workerName: string;
    batchSize: number;
}
