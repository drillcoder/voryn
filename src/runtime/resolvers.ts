import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { validatePostgresSchema } from "../postgres/schema.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { EthersSourceConfig, EthersSourcesConfig } from "../interfaces/source-config.js";
import type { Logger } from "../interfaces/logger.js";
import { ConsoleLogger } from "../loggers/console-logger.js";
import type { ResolveDbDependenciesResult, RuntimeDbOptions, RuntimeLoggerOptions } from "./types.js";

export function resolveLogger(options: RuntimeLoggerOptions): Logger {
    if (options.logger !== undefined) {
        return options.logger;
    }

    return new ConsoleLogger({ minLevel: options.logLevel });
}

export async function resolveEthersSource(config: EthersSourceConfig): Promise<BlockSource> {
    if (config.source !== undefined) {
        return config.source;
    }

    return resolveEthersSources({ chains: [config.chain] });
}

export async function resolveEthersSources(config: EthersSourcesConfig): Promise<BlockSource> {
    if (config.source !== undefined) {
        return config.source;
    }

    const { chains } = config;

    if (chains.length === 0) {
        throw new Error("Ethers source chains config must not be empty");
    }

    for (const chain of chains) {
        if (!Number.isInteger(chain.chainId) || chain.chainId <= 0) {
            throw new Error(`Ethers source chain id is invalid: ${String(chain.chainId)}`);
        }

        if (chain.rpcUrl.trim() === "") {
            throw new Error(`Ethers source rpcUrl is empty for chain ${String(chain.chainId)}`);
        }
    }

    return EthersBlockSource.create(chains.map((chain) => new JsonRpcProvider(chain.rpcUrl)));
}

export async function resolveDbDependencies<TDependencies extends object>(
    options: RuntimeDbOptions<TDependencies>,
    logger: Logger,
    buildDefaults: (pool: Pool) => TDependencies
): Promise<ResolveDbDependenciesResult<TDependencies>> {
    if (options.dbUrl !== undefined) {
        const pool = new PostgresPool({ connectionString: options.dbUrl });

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
