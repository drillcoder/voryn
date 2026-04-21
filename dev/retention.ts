import { RetentionWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS", "60000");
    const retentionDepthBlocks = envNumber("VORYN_RETENTION_DEPTH_BLOCKS", "65000");

    const config = { chainId, delayBetweenTicksMs, retentionDepthBlocks };
    const worker = await RetentionWorker.create({ config, logger, dbUrl });

    await runWorkerLifecycle("retention", worker, logger);
}

runWithErrorHandling("retention", run);
