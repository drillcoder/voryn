import type { BlockSource } from "./block-source.js";
import type { Logger } from "./logger.js";
import type { LogLevel } from "../loggers/console-logger.js";
import type { ChainId } from "../types/chain.js";

export type RuntimeLoggerOptions =
    | { logger: Logger; logLevel?: never; }
    | { logger?: never; logLevel: LogLevel; };

export type RuntimeDbOptions<TDependencies extends object> =
    | { dbUrl: string; overrides?: Partial<TDependencies>; }
    | { dbUrl?: undefined; overrides: TDependencies; };

export type SingleSourceOptions =
    | { source: BlockSource; rpcUrl?: never; rpcRequestTimeoutMs?: never; }
    | { source?: never; rpcUrl: string; rpcRequestTimeoutMs?: number; };

export type MultiSourceOptions =
    | { source: BlockSource; rpcUrls?: never; rpcRequestTimeoutMs?: never; }
    | { source?: never; rpcUrls: readonly string[]; rpcRequestTimeoutMs?: number; };

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

export interface BlockJobRecoveryOptions {
    chainId: ChainId;
}

export interface PipelineMetricsOptions {
    chainIds: readonly ChainId[];
}
