import { hostname } from "node:os";
import { FetchWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const rpcUrl = envValue("VORYN_FETCH_RPC_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_FETCH_DELAY_BETWEEN_TICKS_MS", "100");
    const workerId = envValue("VORYN_FETCH_WORKER_ID", `${hostname()}-${String(process.pid)}`);
    const fetchBatchSize = envNumber("VORYN_FETCH_BATCH_SIZE", "10");
    const fetchClaimTtlMs = envNumber("VORYN_FETCH_CLAIM_TTL_MS", "125000");
    const retryMaxAttempts = envNumber("VORYN_FETCH_RETRY_MAX_ATTEMPTS", "10");
    const retryBaseDelayMs = envNumber("VORYN_FETCH_RETRY_BASE_DELAY_MS", "1000");
    const retryMaxDelayMs = envNumber("VORYN_FETCH_RETRY_MAX_DELAY_MS", "10000");

    const config = {
        chainId,
        delayBetweenTicksMs,
        workerId,
        fetchBatchSize,
        fetchClaimTtlMs,
        retryMaxAttempts,
        retryBaseDelayMs,
        retryMaxDelayMs,
    };
    const worker = await FetchWorker.create({ config, logger, dbUrl, rpcUrl });

    await runWorkerLifecycle("fetch", worker, logger);
}

runWithErrorHandling("fetch", run);
