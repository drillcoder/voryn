import type { CreateHeadWorkerOptions } from "../src/index.js";
import { HeadWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateHeadWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
        rpcUrl: envValue("VORYN_HEAD_RPC_URL", ""),
        delayBetweenTicksMs: envNumber("VORYN_HEAD_DELAY_BETWEEN_TICKS_MS", "1000"),
        confirmations: envNumber("VORYN_HEAD_CONFIRMATIONS", "0"),
        depthBlocks: envNumber("VORYN_HEAD_DEPTH_BLOCKS", "65000"),
    };
    const worker = await HeadWorker.create(options);

    await runWorkerLifecycle("head", worker, createDevLogger());
}

runWithErrorHandling("head", run);
