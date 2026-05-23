import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import type { LogLevel } from "../loggers/console-logger.js";

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
