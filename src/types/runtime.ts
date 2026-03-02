import type { ChainId } from "./chain.js";

export interface RetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

export interface RetentionPolicy {
    rawBlocksHours: number;
    canonicalHours: number;
}

export interface IngestionConfig {
    chainId: ChainId;
    confirmations: number;
    pollIntervalMs: number;
    fetchBatchSize: number;
    retry: RetryPolicy;
    retention: RetentionPolicy;
}

export interface ReactionConfig {
    chainId: ChainId;
    workerName: string;
    pollIntervalMs: number;
    batchSize: number;
}

export interface WorkerLifecycle {
    start(): Promise<void>;

    stop(): Promise<void>;
}
