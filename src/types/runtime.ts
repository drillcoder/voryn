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

export type HeadWorkerConfig = Pick<
    IngestionConfig,
    "chainId" | "pollIntervalMs" | "confirmations"
>;

export type FetchWorkerConfig = Pick<
    IngestionConfig,
    "chainId" | "pollIntervalMs" | "fetchBatchSize" | "retry"
>;

export type SequencerWorkerConfig = Pick<
    IngestionConfig,
    "chainId" | "pollIntervalMs"
>;

export type RetentionWorkerConfig = Pick<
    IngestionConfig,
    "chainId" | "pollIntervalMs" | "retention"
>;

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
