import type { CreateSequencerWorkerOptions } from "../src/index.js";
import { SequencerWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateSequencerWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
        rpcUrl: envValue("VORYN_SEQUENCER_RPC_URL", ""),
        delayBetweenTicksMs: envNumber("VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS", "100"),
        maxBlocksPerTick: envNumber("VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK", "10"),
    };
    const worker = await SequencerWorker.create(options);

    await runWorkerLifecycle("sequencer", worker, createDevLogger());
}

runWithErrorHandling("sequencer", run);
