#!/usr/bin/env node

import { hostname } from "node:os";
import { JsonRpcProvider } from "ethers";
import type { ChainCursorBootstrapper, PgPool } from "./stores/postgres/index.js";
import {
    createPostgresPool,
    PostgresBlockJobQueueStore,
    PostgresChainCursorStore,
    PostgresLeaderLock,
    PostgresRawBlockStore,
    PostgresRetentionStore,
    PostgresSequencerCommitStore,
} from "./stores/postgres/index.js";
import { EthersBlockSource } from "./adapters/ethers-block-source.js";
import { initPostgresDb } from "./db/init-postgres.js";
import type { LogLevel } from "./loggers/console-logger.js";
import { createConsoleLogger } from "./loggers/console-logger.js";
import { FetchWorker, HeadWorker, RetentionWorker, SequencerWorker } from "./index.js";
import { asHash32 } from "./utils/hex.js";

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
        + "  VORYN_FETCH_RETRY_MAX_ATTEMPTS    optional, default: 10\n"
        + "  VORYN_FETCH_RETRY_BASE_DELAY_MS   optional, default: 1_000\n"
        + "  VORYN_FETCH_RETRY_MAX_DELAY_MS    optional, default: 10_000\n"
        + "\n"
        + "Head env:\n"
        + "  VORYN_HEAD_RPC_URL                required\n"
        + "  VORYN_HEAD_POLL_INTERVAL_MS       optional, default: 1_000\n"
        + "  VORYN_HEAD_CONFIRMATIONS          optional, default: 0\n"
        + "\n"
        + "Sequencer env:\n"
        + "  VORYN_SEQUENCER_RPC_URL           required\n"
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

const createBootstrapper = (rpcUrl: string, chainId: number): ChainCursorBootstrapper =>
    async () => {
        const provider = new JsonRpcProvider(rpcUrl);
        const blockNumber = await provider.getBlockNumber();
        const block = await provider.getBlock(blockNumber, false);
        const blockHash = block?.hash;

        if (blockHash === undefined || blockHash === null) {
            throw new Error(`failed to read bootstrap block for chain ${String(chainId)}`);
        }

        return {
            lastEnqueuedBlock: blockNumber,
            lastCommittedBlock: blockNumber,
            lastCommittedHash: asHash32(blockHash),
        };
    };

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
    pool: PgPool
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

    const pool = createPostgresPool({ connectionString: dbUrl });
    const worker = new HeadWorker({
        config: { chainId, pollIntervalMs, confirmations },
        source: new EthersBlockSource({ provider: new JsonRpcProvider(rpcUrl), validateProviderChainId: true }),
        cursorStore: new PostgresChainCursorStore(pool, createBootstrapper(rpcUrl, chainId)),
        jobStore: new PostgresBlockJobQueueStore(pool),
        leaderLock: new PostgresLeaderLock(pool, 10_000_000n + BigInt(chainId)),
        logger,
    });

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
    const maxAttempts = parsePositiveIntEnv("VORYN_FETCH_RETRY_MAX_ATTEMPTS", 10);
    const baseDelayMs = parsePositiveIntEnv("VORYN_FETCH_RETRY_BASE_DELAY_MS", 1_000);
    const maxDelayMs = parsePositiveIntEnv("VORYN_FETCH_RETRY_MAX_DELAY_MS", 10_000);

    const pool = createPostgresPool({ connectionString: dbUrl });
    const worker = new FetchWorker({
        workerId: workerId,
        config: { chainId, pollIntervalMs, fetchBatchSize, retry: { maxAttempts, baseDelayMs, maxDelayMs } },
        source: new EthersBlockSource({ provider: new JsonRpcProvider(rpcUrl), validateProviderChainId: true }),
        jobStore: new PostgresBlockJobQueueStore(pool),
        rawBlockStore: new PostgresRawBlockStore(pool),
        logger,
    });

    await runWorkerLifecycle("fetch", worker, logger, pool);
}

async function runSequencerCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const rpcUrl = requireEnv("VORYN_SEQUENCER_RPC_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_SEQUENCER_POLL_INTERVAL_MS", 500);

    const pool = createPostgresPool({ connectionString: dbUrl });
    const worker = new SequencerWorker({
        config: { chainId, pollIntervalMs },
        cursorStore: new PostgresChainCursorStore(pool, createBootstrapper(rpcUrl, chainId)),
        commitStore: new PostgresSequencerCommitStore(pool),
        leaderLock: new PostgresLeaderLock(pool, 20_000_000n + BigInt(chainId)),
        logger,
    });

    await runWorkerLifecycle("sequencer", worker, logger, pool);
}

async function runRetentionCommand(): Promise<void> {
    const logger = createConsoleLogger({ minLevel: parseLogLevel() });
    const dbUrl = requireEnv("DATABASE_URL");
    const chainId = parseRequiredPositiveIntEnv("VORYN_CHAIN_ID");
    const pollIntervalMs = parsePositiveIntEnv("VORYN_RETENTION_POLL_INTERVAL_MS", 60_000);

    const depthBlocks = parseNonNegativeIntEnv("VORYN_RETENTION_DEPTH_BLOCKS", 65_000);
    const pool = createPostgresPool({ connectionString: dbUrl });
    const worker = new RetentionWorker({
        config: { chainId, pollIntervalMs, retention: { depthBlocks } },
        store: new PostgresRetentionStore(pool),
        leaderLock: new PostgresLeaderLock(pool, 30_000_000n + BigInt(chainId)),
        logger,
    });

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
