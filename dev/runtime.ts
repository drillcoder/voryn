import type { Pool } from "pg";
import type { Logger, LogLevel, WorkerLifecycle } from "../src/index.js";
import { ConsoleLogger, validatePostgresSchema } from "../src/index.js";

export function envValue(name: string, defaultValue: string): string {
    const value = process.env[name];
    if (value === undefined || value === "") {
        return defaultValue;
    }

    return value;
}

export function envNumber(name: string, defaultValue: string): number {
    return Number(envValue(name, defaultValue));
}

export function createDevLogger(): Logger {
    return new ConsoleLogger({ minLevel: envValue("VORYN_LOG_LEVEL", "info") as LogLevel });
}

async function waitForShutdownSignal(): Promise<NodeJS.Signals> {
    return await new Promise<NodeJS.Signals>((resolve) => {
        process.once("SIGINT", () => {
            resolve("SIGINT");
        });
        process.once("SIGTERM", () => {
            resolve("SIGTERM");
        });
    });
}

export async function runWorkerLifecycle(
    command: "head" | "fetch" | "sequencer" | "retention",
    worker: WorkerLifecycle,
    logger: Logger,
    pool: Pool
): Promise<void> {
    try {
        await validatePostgresSchema({ pool, logger });
        await worker.start();
        const signal = await waitForShutdownSignal();
        logger.info("worker_shutdown_signal_received", { command, signal });
        await worker.stop();
    } finally {
        await pool.end();
    }
}

export function runWithErrorHandling(command: string, run: () => Promise<void>): void {
    run().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`voryn ${command} failed: ${message}`);
        process.exitCode = 1;
    });
}
