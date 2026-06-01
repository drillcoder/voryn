import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { validatePostgresSchema } from "../postgres/schema.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { ConsoleLogger } from "../loggers/console-logger.js";
import type {
    MultiSourceOptions,
    RuntimeDbOptions,
    RuntimeLoggerOptions,
    SingleSourceOptions,
} from "../interfaces/options.js";

interface ResolveDbDependenciesResult<TDependencies extends object> {
    dependencies: TDependencies;
    dispose?: () => Promise<void>;
}

export function resolveLogger(options: RuntimeLoggerOptions): Logger {
    if (options.logger !== undefined) {
        return options.logger;
    }

    return new ConsoleLogger({ minLevel: options.logLevel });
}

export async function resolveSingleBlockSource(options: SingleSourceOptions): Promise<BlockSource> {
    if (options.source !== undefined) {
        return options.source;
    }

    return resolveMultiBlockSource({ rpcUrls: [options.rpcUrl] });
}

export async function resolveMultiBlockSource(options: MultiSourceOptions): Promise<BlockSource> {
    if (options.source !== undefined) {
        return options.source;
    }

    const { rpcUrls } = options;

    if (rpcUrls.length === 0) {
        throw new Error("Ethers source rpcUrls config must not be empty");
    }

    for (const rpcUrl of rpcUrls) {
        if (rpcUrl.trim() === "") {
            throw new Error("Ethers source rpcUrl is empty");
        }
    }

    return EthersBlockSource.create(rpcUrls.map((rpcUrl) => new JsonRpcProvider(rpcUrl)));
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
