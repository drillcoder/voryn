import { HeadWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const rpcUrl = envValue("VORYN_HEAD_RPC_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_HEAD_DELAY_BETWEEN_TICKS_MS", "1000");
    const confirmations = envNumber("VORYN_HEAD_CONFIRMATIONS", "0");
    const depthBlocks = envNumber("VORYN_HEAD_DEPTH_BLOCKS", "65000");

    const config = { chainId, delayBetweenTicksMs, confirmations, depthBlocks };

    await runWorkerLifecycle("head", HeadWorker.create({ config, logger, dbUrl, rpcUrl }), logger);
}

runWithErrorHandling("head", run);
