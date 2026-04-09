#!/usr/bin/env node

import type { LogLevel } from "./loggers/console-logger.js";
import { ConsoleLogger } from "./loggers/console-logger.js";
import { initPostgresDb } from "./db/init-postgres.js";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const isLogLevel = (value: string): value is LogLevel =>
    LOG_LEVELS.some((level) => level === value);

function printUsage(): void {
    // eslint-disable-next-line no-console
    console.log(
        "Usage:\n"
        + "  voryn init\n\n"
        + "Common env:\n"
        + "  DATABASE_URL                      required\n"
        + "  VORYN_LOG_LEVEL                   optional, default: info"
    );
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`environment variable ${name} is required`);
    }

    return value;
}

function parseLogLevel(): LogLevel {
    const value = process.env.VORYN_LOG_LEVEL?.toLowerCase();
    if (value === undefined || value === "") {
        return "info";
    }

    if (isLogLevel(value)) {
        return value;
    }

    throw new Error("environment variable VORYN_LOG_LEVEL must be one of: debug, info, warn, error");
}

async function runInitCommand(): Promise<void> {
    const logger = new ConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    await initPostgresDb({ url: dbUrl, logger });
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printUsage();
        process.exitCode = 0;
        return;
    }

    const commandText = args.join(" ");
    if (commandText !== "init") {
        throw new Error(`unknown command: ${commandText || "(empty)"}`);
    }

    await runInitCommand();
}

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    const commandText = process.argv.slice(2).join(" ") || "(empty)";
    // eslint-disable-next-line no-console
    console.error(`voryn ${commandText} failed: ${message}`);
    process.exitCode = 1;
});
