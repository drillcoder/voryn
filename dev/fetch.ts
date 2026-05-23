import type { CreateFetchWorkerOptions } from "../src/index.js";
import { FetchWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateFetchWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
        rpcUrl: envValue("VORYN_FETCH_RPC_URL", ""),
        delayBetweenTicksMs: envNumber("VORYN_FETCH_DELAY_BETWEEN_TICKS_MS", "100"),
        fetchBatchSize: envNumber("VORYN_FETCH_BATCH_SIZE", "10"),
        fetchConcurrency: envNumber("VORYN_FETCH_CONCURRENCY", "1"),
        fetchClaimTtlMs: envNumber("VORYN_FETCH_CLAIM_TTL_MS", "125000"),
        retryMaxAttempts: envNumber("VORYN_FETCH_RETRY_MAX_ATTEMPTS", "10"),
        retryBaseDelayMs: envNumber("VORYN_FETCH_RETRY_BASE_DELAY_MS", "1000"),
        retryMaxDelayMs: envNumber("VORYN_FETCH_RETRY_MAX_DELAY_MS", "10000"),
    };
    const worker = await FetchWorker.create(options);

    await runWorkerLifecycle("fetch", worker, createDevLogger());
}

runWithErrorHandling("fetch", run);
