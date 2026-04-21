import { SequencerWorker } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS", "100");
    const maxBlocksPerTick = envNumber("VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK", "10");

    const config = { chainId, delayBetweenTicksMs, maxBlocksPerTick };

    await runWorkerLifecycle("sequencer", SequencerWorker.create({ config, logger, dbUrl }), logger);
}

runWithErrorHandling("sequencer", run);
