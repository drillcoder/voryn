import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import type { LogLevel } from "../loggers/console-logger.js";
import type { ChainId } from "../types/chain.js";

export type RuntimeLoggerOptions =
    | { logger: Logger; logLevel?: never }
    | { logger?: never; logLevel: LogLevel };

export interface ResolveDbDependenciesResult<TDependencies extends object> {
    dependencies: TDependencies;
    dispose?: () => Promise<void>;
}

export type RuntimeDbOptions<TDependencies extends object> =
    | {
        dbUrl: string;
        overrides?: Partial<TDependencies>;
    }
    | {
        dbUrl?: undefined;
        overrides: TDependencies;
    };

export type SingleSourceOptions =
    | {
        source: BlockSource;
        rpcUrl?: never;
    }
    | {
        source?: never;
        rpcUrl: string;
    };

export type MultiSourceOptions =
    | {
        source: BlockSource;
        rpcUrls?: never;
    }
    | {
        source?: never;
        rpcUrls: readonly string[];
    };

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
