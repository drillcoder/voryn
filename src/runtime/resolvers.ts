import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { validatePostgresSchema } from "../postgres/schema.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { EthersSourceConfig, EthersSourcesConfig } from "../interfaces/source-config.js";
import type { Logger } from "../interfaces/logger.js";
import { ConsoleLogger } from "../loggers/console-logger.js";
import type { ChainId } from "../types/chain.js";
import type { ResolveDbDependenciesResult, RuntimeDbOptions, RuntimeLoggerOptions } from "./types.js";

export function resolveLogger(options: RuntimeLoggerOptions): Logger {
    if (options.logger !== undefined) {
        return options.logger;
    }

    return new ConsoleLogger({ minLevel: options.logLevel });
}

export function resolveEthersSource(config: EthersSourceConfig): BlockSource {
    if (config.source !== undefined) {
        return config.source;
    }

    return resolveEthersSources({ chains: [config.chain] });
}

export function resolveEthersSources(config: EthersSourcesConfig): BlockSource {
    if (config.source !== undefined) {
        return config.source;
    }

    const { chains } = config;

    if (chains.length === 0) {
        throw new Error("Ethers source chains config must not be empty");
    }

    const seenChainIds = new Set<ChainId>();

    for (const chain of chains) {
        if (!Number.isInteger(chain.chainId) || chain.chainId <= 0) {
            throw new Error(`Ethers source chain id is invalid: ${String(chain.chainId)}`);
        }

        if (seenChainIds.has(chain.chainId)) {
            throw new Error(`Ethers source chain id is duplicated: ${String(chain.chainId)}`);
        }

        seenChainIds.add(chain.chainId);

        if (chain.rpcUrl.trim() === "") {
            throw new Error(`Ethers source rpcUrl is empty for chain ${String(chain.chainId)}`);
        }
    }

    return new EthersBlockSource({
        providers: new Map(chains.map((chain) => [chain.chainId, new JsonRpcProvider(chain.rpcUrl)])),
        validateProviderChainId: true,
    });
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
