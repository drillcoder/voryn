#!/usr/bin/env node

import { initPostgresDb } from "./db/init-postgres.js";

interface CliOptions {
    url?: string;
}

interface ParsedCommand {
    command: string[];
    options: CliOptions;
}

function parseCommand(argv: string[]): ParsedCommand {
    const command: string[] = [];
    const options: CliOptions = {};

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === "--url") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) {
                throw new Error("option --url requires a value");
            }
            options.url = value;
            i += 1;
            continue;
        }
        if (token.startsWith("--url=")) {
            options.url = token.slice("--url=".length);
            continue;
        }
        if (token.startsWith("--")) {
            throw new Error(`unknown option: ${token}`);
        }
        command.push(token);
    }

    return { command, options };
}

function printUsage(): void {
    // eslint-disable-next-line no-console
    console.log(
        "Usage:\n"
            + "  voryn db init [--url <postgres-url>]\n\n"
            + "Options:\n"
            + "  --url       Postgres connection string. Fallback: DATABASE_URL"
    );
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printUsage();
        process.exitCode = 0;
        return;
    }

    const { command, options } = parseCommand(args);
    const commandText = command.join(" ");

    if (commandText !== "db init") {
        throw new Error(`unknown command: ${commandText || "(empty)"}`);
    }

    const dbUrl = options.url ?? process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error("database url is missing. pass --url or set DATABASE_URL");
    }

    await initPostgresDb({ url: dbUrl });

    // eslint-disable-next-line no-console
    console.log("database schema initialized");
}

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    // eslint-disable-next-line no-console
    console.error(`voryn db init failed: ${message}`);
    process.exitCode = 1;
});
