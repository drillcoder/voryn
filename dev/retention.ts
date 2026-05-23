import type { CreateRetentionWorkerOptions } from "../src/index.js";
import { RetentionWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateRetentionWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
        delayBetweenTicksMs: envNumber("VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS", "60000"),
        retentionDepthBlocks: envNumber("VORYN_RETENTION_DEPTH_BLOCKS", "65000"),
    };
    const worker = await RetentionWorker.create(options);

    await runWorkerLifecycle("retention", worker, createDevLogger());
}

runWithErrorHandling("retention", run);
