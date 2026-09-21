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

export interface RpcNetworkConfig {
    chainId: ChainId;
    rpcUrls: readonly string[];
}

export type SingleChainSourceConfig = {
    chainId?: never;
    source?: never;
    network: RpcNetworkConfig;
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
} | {
    chainId: ChainId;
    source: BlockSource;
    network?: never;
    requestTimeoutMs?: never;
    operationTimeoutMs?: never;
};

export type MultiChainSourceConfig = {
    chainIds?: never;
    source?: never;
    networks: readonly RpcNetworkConfig[];
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
} | {
    chainIds: readonly ChainId[];
    source: BlockSource;
    networks?: never;
    requestTimeoutMs?: never;
    operationTimeoutMs?: never;
}

export interface HeadWorkerOptions {
    sourceConfig: SingleChainSourceConfig;
    delayBetweenTicksMs: number;
    confirmations: number;
    depthBlocks: number;
}

export interface FetchWorkerOptions {
    sourceConfig: SingleChainSourceConfig;
    delayBetweenTicksMs: number;
    fetchBatchSize: number;
    fetchConcurrency: number;
    fetchClaimTtlMs: number;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
}

export interface SequencerWorkerOptions {
    sourceConfig: SingleChainSourceConfig;
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
    sourceConfig: MultiChainSourceConfig;
}
