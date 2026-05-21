import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { validatePostgresSchema } from "../postgres/schema.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { ChainId } from "../types/chain.js";
import type { ResolveDbDependenciesResult, RuntimeDbOptions, RuntimeSourceOptions } from "./types.js";

export function resolveEthersSource(
    chainId: ChainId,
    options: RuntimeSourceOptions<BlockSource>
): BlockSource {
    if (options.source !== undefined) {
        return options.source;
    }

    return new EthersBlockSource({
        providers: new Map([[chainId, new JsonRpcProvider(options.rpcUrl)]]),
        validateProviderChainId: true,
    });
}

export async function resolveDbDependencies<TDependencies extends object>(
    options: RuntimeDbOptions<TDependencies> & { logger?: Logger },
    buildDefaults: (pool: Pool) => TDependencies
): Promise<ResolveDbDependenciesResult<TDependencies>> {
    if (options.dbUrl !== undefined) {
        const pool = new PostgresPool({ connectionString: options.dbUrl });

        try {
            await validatePostgresSchema({ pool, logger: options.logger ?? noopLogger });

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
