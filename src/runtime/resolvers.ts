import { Pool as PostgresPool } from "pg";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { noopLogger } from "../interfaces/logger.js";
import { ConsoleLogger } from "../loggers/console-logger.js";
import { validatePostgresSchema } from "../postgres/schema.js";

import type { Pool } from "pg";
import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import type { MultiChainSourceConfig, SingleChainSourceConfig } from "../interfaces/source-config.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "./options.js";
import type { ChainId } from "../types/chain.js";

type AsyncDisposer = () => Promise<void>;

interface ResolveDbDependenciesResult<TDependencies extends object> {
    dependencies: TDependencies;
    dispose?: AsyncDisposer;
}

export interface ResolvedBlockSource {
    source: BlockSource;
    dispose?: AsyncDisposer;
}

const POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS = 30_000;

export function resolveLogger(options: RuntimeLoggerOptions): Logger {
    if (options.logger !== undefined) {
        return options.logger;
    }

    return new ConsoleLogger({ minLevel: options.logLevel });
}

export function resolveSingleChainId(config: SingleChainSourceConfig): ChainId {
    return config.network !== undefined ? config.network.chainId : config.chainId;
}

export async function resolveSingleBlockSource(
    config: SingleChainSourceConfig,
    logger: Logger = noopLogger,
): Promise<ResolvedBlockSource> {
    if (config.source !== undefined) {
        return { source: config.source };
    }

    return resolveMultiBlockSource({
        networks: [config.network],
        requestTimeoutMs: config.requestTimeoutMs,
        operationTimeoutMs: config.operationTimeoutMs,
    }, logger);
}

export async function resolveMultiBlockSource(
    config: MultiChainSourceConfig,
    logger: Logger = noopLogger,
): Promise<ResolvedBlockSource> {
    if (config.source !== undefined) {
        return { source: config.source };
    }

    const source = await EthersBlockSource.create({
        networks: config.networks,
        requestTimeoutMs: config.requestTimeoutMs,
        operationTimeoutMs: config.operationTimeoutMs,
        logger,
    });

    return {
        source,
        dispose: async () => source.close(),
    };
}

export function combineDisposers(...disposers: (AsyncDisposer | undefined)[]): AsyncDisposer | undefined {
    const available = disposers.filter((dispose): dispose is AsyncDisposer => dispose !== undefined);
    if (available.length === 0) {
        return undefined;
    }

    return async (): Promise<void> => {
        const errors: unknown[] = [];
        for (const dispose of available) {
            try {
                await dispose();
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length === 1) {
            throw errors[0];
        }
        if (errors.length > 1) {
            throw new AggregateError(errors, "Multiple resource cleanup operations failed");
        }
    };
}

export async function disposeAfterError(
    error: unknown,
    ...disposers: (AsyncDisposer | undefined)[]
): Promise<never> {
    try {
        await combineDisposers(...disposers)?.();
    } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Initialization and resource cleanup failed");
    }

    throw error;
}

export async function resolveDbDependencies<TDependencies extends object>(
    options: RuntimeDbOptions<TDependencies>,
    logger: Logger,
    buildDefaults: (pool: Pool) => TDependencies
): Promise<ResolveDbDependenciesResult<TDependencies>> {
    if (options.dbUrl !== undefined) {
        const pool = new PostgresPool({
            connectionString: options.dbUrl,
            keepAlive: true,
            keepAliveInitialDelayMillis: POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS,
        });

        try {
            await validatePostgresSchema({ pool, logger });

            const defaults = buildDefaults(pool);

            return {
                dependencies: {
                    ...defaults,
                    ...options.overrides,
                },
                dispose: async () => {
                    await pool.end();
                },
            };
        } catch (error) {
            await pool.end();
            throw error;
        }
    }

    return {
        dependencies: options.overrides,
    };
}
