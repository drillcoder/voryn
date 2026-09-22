import type { Logger } from "../interfaces/logger.js";
import type { LogLevel } from "../loggers/console-logger.js";

export type RuntimeLoggerOptions =
    | { logger: Logger; logLevel?: never; }
    | { logger?: never; logLevel: LogLevel; };

export type RuntimeDbOptions<TDependencies extends object> =
    | { dbUrl: string; overrides?: Partial<TDependencies>; }
    | { dbUrl?: undefined; overrides: TDependencies; };
