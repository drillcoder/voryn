import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { FetchRequest, JsonRpcProvider } from "ethers";
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

const DEFAULT_RPC_REQUEST_TIMEOUT_MS = 30_000;
const POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS = 30_000;

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

    return resolveMultiBlockSource({
        rpcUrls: [options.rpcUrl],
        rpcRequestTimeoutMs: options.rpcRequestTimeoutMs,
    });
}

export async function resolveMultiBlockSource(options: MultiSourceOptions): Promise<BlockSource> {
    if (options.source !== undefined) {
        return options.source;
    }

    const {
        rpcUrls,
        rpcRequestTimeoutMs = DEFAULT_RPC_REQUEST_TIMEOUT_MS,
    } = options;

    if (rpcUrls.length === 0) {
        throw new Error("Ethers source rpcUrls config must not be empty");
    }

    for (const rpcUrl of rpcUrls) {
        if (rpcUrl.trim() === "") {
            throw new Error("Ethers source rpcUrl is empty");
        }
    }

    if (!Number.isSafeInteger(rpcRequestTimeoutMs) || rpcRequestTimeoutMs <= 0) {
        throw new Error("Ethers source rpcRequestTimeoutMs must be a positive safe integer");
    }

    return EthersBlockSource.create(rpcUrls.map((rpcUrl) => {
        const request = new FetchRequest(rpcUrl);
        request.timeout = rpcRequestTimeoutMs;
        request.retryFunc = () => Promise.resolve(false);

        return new JsonRpcProvider(request);
    }));
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
