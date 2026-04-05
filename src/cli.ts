#!/usr/bin/env node

import { hostname } from "node:os";
import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import { PostgresLeaderLock, PostgresTransactionManager } from "./postgres/index.js";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
} from "./repositories/postgres/index.js";
import { EthersBlockSource } from "./adapters/ethers-block-source.js";
import { initPostgresDb } from "./db/init-postgres.js";
import type { LogLevel } from "./loggers/console-logger.js";
import { createConsoleLogger } from "./loggers/console-logger.js";
import { FetchWorker, HeadWorker, RetentionWorker, SequencerWorker } from "./index.js";

type Command = "init" | "head" | "fetch" | "sequencer" | "retention";

const COMMANDS: readonly Command[] = ["init", "head", "fetch", "sequencer", "retention"];

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const isLogLevel = (value: string): value is LogLevel =>
    LOG_LEVELS.some((level) => level === value);

const isCommand = (value: string): value is Command =>
    COMMANDS.some((command) => command === value);

const parseCommand = (args: string[]): Command => {
    const commandText = args.join(" ");
    if (!isCommand(commandText)) {
        throw new Error(`unknown command: ${commandText || "(empty)"}`);
    }

    return commandText;
};

function printUsage(): void {
    // eslint-disable-next-line no-console
    console.log(
        "Usage:\n"
        + "  voryn init\n"
        + "  voryn head\n"
        + "  voryn fetch\n"
        + "  voryn sequencer\n"
        + "  voryn retention\n\n"
        + "Common env:\n"
        + "  DATABASE_URL                      required\n"
        + "  VORYN_CHAIN_ID                    required\n"
        + "  VORYN_LOG_LEVEL                   optional, default: info\n"
        + "\n"
        + "Fetch env:\n"
        + "  VORYN_FETCH_RPC_URL               required\n"
        + "  VORYN_FETCH_POLL_INTERVAL_MS      optional, default: 1000\n"
        + "  VORYN_FETCH_WORKER_ID             optional, default: <hostname>-<pid>\n"
        + "  VORYN_FETCH_BATCH_SIZE            optional, default: 5\n"
        + "  VORYN_FETCH_CLAIM_TTL_MS          optional, default: 125_000\n"
        + "  VORYN_FETCH_RETRY_MAX_ATTEMPTS    optional, default: 10\n"
        + "  VORYN_FETCH_RETRY_BASE_DELAY_MS   optional, default: 1_000\n"
        + "  VORYN_FETCH_RETRY_MAX_DELAY_MS    optional, default: 10_000\n"
        + "\n"
        + "Head env:\n"
        + "  VORYN_HEAD_RPC_URL                required\n"
        + "  VORYN_HEAD_POLL_INTERVAL_MS       optional, default: 1_000\n"
        + "  VORYN_HEAD_CONFIRMATIONS          optional, default: 0\n"
        + "  VORYN_HEAD_DEPTH_BLOCKS           optional, default: 65_000\n"
        + "\n"
        + "Sequencer env:\n"
        + "  VORYN_SEQUENCER_POLL_INTERVAL_MS  optional, default: 500\n"
        + "\n"
        + "Retention env:\n"
        + "  VORYN_RETENTION_POLL_INTERVAL_MS  optional, default: 60_000\n"
        + "  VORYN_RETENTION_DEPTH_BLOCKS      optional, default: 65_000"
    );
}

function parseIntEnv(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") {
        return defaultValue;
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`environment variable ${name} must be a safe integer`);
    }

    return parsed;
}

function parseNonNegativeIntEnv(name: string, defaultValue: number): number {
    const value = parseIntEnv(name, defaultValue);
    if (value < 0) {
        throw new Error(`environment variable ${name} must be >= 0`);
    }

    return value;
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
    const value = parseIntEnv(name, defaultValue);
    if (value <= 0) {
        throw new Error(`environment variable ${name} must be > 0`);
    }

    return value;
}

function parseRequiredPositiveIntEnv(name: string): number {
    const value = requireEnv(name);
    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`environment variable ${name} must be a positive safe integer`);
    }

    return parsed;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`environment variable ${name} is required`);
    }

    return value;
}

function optionalEnv(name: string, defaultValue: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") {
        return defaultValue;
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

async function waitForShutdownSignal(): Promise<NodeJS.Signals> {
    return await new Promise<NodeJS.Signals>((resolve) => {
        const onSignal = (signal: NodeJS.Signals): void => {
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
            resolve(signal);
        };

        const onSigint = (): void => {
            onSignal("SIGINT");
        };
        const onSigterm = (): void => {
            onSignal("SIGTERM");
        };

        process.on("SIGINT", onSigint);
        process.on("SIGTERM", onSigterm);
    });
}

async function runWorkerLifecycle(
    command: Exclude<Command, "init">,
    worker: HeadWorker | FetchWorker | SequencerWorker | RetentionWorker,
    logger: ReturnType<typeof createConsoleLogger>,
    pool: Pool
): Promise<void> {
    try {
        await worker.start();
        const signal = await waitForShutdownSignal();
        logger.info("worker_shutdown_signal_received", { command, signal });
        await worker.stop();
    } finally {
        await pool.end();
    }
}

async function runInitCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    await initPostgresDb({ url: dbUrl, logger });
}

async function runHeadCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const rpcUrl = requireEnv("VORYN_HEAD_RPC_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_HEAD_POLL_INTERVAL_MS", 1_000);

    const confirmations = parseNonNegativeIntEnv("VORYN_HEAD_CONFIRMATIONS", 0);
    const depthBlocks = parsePositiveIntEnv("VORYN_HEAD_DEPTH_BLOCKS", 65_000);

    const pool = new Pool({ connectionString: dbUrl });
    const cursorRepository = new PostgresChainCursorRepository(pool);
    const blockJobsRepository = new PostgresBlockJobsRepository(pool);
    const worker = new HeadWorker(
        { chainId, pollIntervalMs, confirmations, depthBlocks },
        new EthersBlockSource({ provider: new JsonRpcProvider(rpcUrl), validateProviderChainId: true }),
        cursorRepository,
        blockJobsRepository,
        new PostgresRawBlocksRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 10_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("head", worker, logger, pool);
}

async function runFetchCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const rpcUrl = requireEnv("VORYN_FETCH_RPC_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_FETCH_POLL_INTERVAL_MS", 1_000);

    const workerId = optionalEnv("VORYN_FETCH_WORKER_ID", `${hostname()}-${String(process.pid)}`);
    const fetchBatchSize = parsePositiveIntEnv("VORYN_FETCH_BATCH_SIZE", 5);
    const fetchClaimTtlMs = parsePositiveIntEnv("VORYN_FETCH_CLAIM_TTL_MS", 125_000);
    const retryMaxAttempts = parsePositiveIntEnv("VORYN_FETCH_RETRY_MAX_ATTEMPTS", 10);
    const retryBaseDelayMs = parsePositiveIntEnv("VORYN_FETCH_RETRY_BASE_DELAY_MS", 1_000);
    const retryMaxDelayMs = parsePositiveIntEnv("VORYN_FETCH_RETRY_MAX_DELAY_MS", 10_000);

    const pool = new Pool({ connectionString: dbUrl });
    const worker = new FetchWorker(
        workerId,
        {
            chainId,
            pollIntervalMs,
            fetchBatchSize,
            fetchClaimTtlMs,
            retryMaxAttempts,
            retryBaseDelayMs,
            retryMaxDelayMs,
        },
        new EthersBlockSource({ provider: new JsonRpcProvider(rpcUrl), validateProviderChainId: true }),
        new PostgresBlockJobsRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresTransactionManager(pool),
        logger,
    );

    await runWorkerLifecycle("fetch", worker, logger, pool);
}

async function runSequencerCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_SEQUENCER_POLL_INTERVAL_MS", 500);

    const pool = new Pool({ connectionString: dbUrl });
    const worker = new SequencerWorker(
        { chainId, pollIntervalMs },
        new PostgresChainCursorRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresCanonicalBlocksRepository(pool),
        new PostgresCanonicalTransactionsRepository(pool),
        new PostgresCanonicalEventsRepository(pool),
        new PostgresBlockJobsRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 20_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("sequencer", worker, logger, pool);
}

async function runRetentionCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_RETENTION_POLL_INTERVAL_MS", 60_000);

    const retentionDepthBlocks = parseNonNegativeIntEnv("VORYN_RETENTION_DEPTH_BLOCKS", 65_000);
    const pool = new Pool({ connectionString: dbUrl });
    const worker = new RetentionWorker(
        { chainId, pollIntervalMs, retentionDepthBlocks },
        new PostgresChainCursorRepository(pool),
        new PostgresBlockJobsRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresCanonicalBlocksRepository(pool),
        new PostgresCanonicalTransactionsRepository(pool),
        new PostgresCanonicalEventsRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 30_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("retention", worker, logger, pool);
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printUsage();
        process.exitCode = 0;
        return;
    }

    const command = parseCommand(args);
    const COMMAND_EXECUTORS: Record<Command, () => Promise<void>> = {
        init: runInitCommand,
        head: runHeadCommand,
        fetch: runFetchCommand,
        sequencer: runSequencerCommand,
        retention: runRetentionCommand,
    };
    await COMMAND_EXECUTORS[command]();
}

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    const commandText = process.argv.slice(2).join(" ") || "(empty)";
    // eslint-disable-next-line no-console
    console.error(`voryn ${commandText} failed: ${message}`);
    process.exitCode = 1;
});
