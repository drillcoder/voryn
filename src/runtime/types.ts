import type { Logger } from "../interfaces/logger.js";
import type { LogLevel } from "../loggers/console-logger.js";

export type RuntimeBaseOptions<TConfig> = RuntimeLoggerOptions & {
    config: TConfig;
};

export type RuntimeLoggerOptions =
    | { logger: Logger; logLevel?: never }
    | { logger?: never; logLevel: LogLevel };

export type RuntimeSourceOptions<TSource> =
    | { source: TSource; rpcUrl?: never }
    | { source?: never; rpcUrl: string };

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

export type ReactionWorkerOptions<TConfig, THandler, TDependencies extends object> =
    RuntimeBaseOptions<TConfig>
    & RuntimeDbOptions<TDependencies>
    & { handler: THandler };
