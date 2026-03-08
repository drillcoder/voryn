import type { Logger } from "../interfaces/logger.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ConsoleLogWriter {
    write(message: string): unknown;
    isTTY?: boolean;
}

export interface ConsoleLoggerOptions {
    minLevel?: LogLevel;
    colorize?: boolean;
    timestamp?: boolean;
    stdout?: ConsoleLogWriter;
    stderr?: ConsoleLogWriter;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
    debug: "\u001b[36m",
    info: "\u001b[32m",
    warn: "\u001b[33m",
    error: "\u001b[31m",
};

const COLOR_RESET = "\u001b[0m";

const serializeMeta = (meta: Record<string, unknown>): string => {
    const seen = new WeakSet();

    const replacer = (_key: string, value: unknown): unknown => {
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
            };
        }

        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return "[circular]";
            }
            seen.add(value);
        }

        return value;
    };

    return JSON.stringify(meta, replacer);
};

const shouldColorize = (
    option: boolean | undefined,
    stdout: ConsoleLogWriter,
    stderr: ConsoleLogWriter
): boolean => {
    if (option !== undefined) {
        return option;
    }

    if (process.env.NO_COLOR !== undefined) {
        return false;
    }

    return stdout.isTTY === true || stderr.isTTY === true;
};

const formatLevel = (level: LogLevel, colorize: boolean): string => {
    const levelText = level.toUpperCase();
    if (!colorize) {
        return levelText;
    }

    return `${LOG_LEVEL_COLORS[level]}${levelText}${COLOR_RESET}`;
};

const formatLine = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> | undefined,
    includeTimestamp: boolean,
    colorize: boolean
): string => {
    const parts = [];

    if (includeTimestamp) {
        parts.push(new Date().toISOString());
    }

    parts.push(formatLevel(level, colorize));
    parts.push(message);

    if (meta !== undefined) {
        parts.push(serializeMeta(meta));
    }

    return `${parts.join(" ")}\n`;
};

export const createConsoleLogger = (options: ConsoleLoggerOptions = {}): Logger => {
    const minLevel = options.minLevel ?? "debug";
    const includeTimestamp = options.timestamp ?? true;
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const colorize = shouldColorize(options.colorize, stdout, stderr);

    const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
        if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
            return;
        }

        const line = formatLine(level, message, meta, includeTimestamp, colorize);
        const stream = level === "warn" || level === "error" ? stderr : stdout;
        stream.write(line);
    };

    return {
        debug: (message, meta) => {
            log("debug", message, meta);
        },
        info: (message, meta) => {
            log("info", message, meta);
        },
        warn: (message, meta) => {
            log("warn", message, meta);
        },
        error: (message, meta) => {
            log("error", message, meta);
        },
    };
};
