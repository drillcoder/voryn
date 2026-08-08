import type { CreateSequencerWorkerOptions } from "../src/index.js";
import { SequencerWorker } from "../src/index.js";
import {
    createDevLogger,
    envNumber,
    envValue,
    runWithErrorHandling,
    runWorkerLifecycleWithFailure,
} from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateSequencerWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
        rpcConfig: {
            rpcUrl: envValue("VORYN_SEQUENCER_RPC_URL", ""),
            fallbackRpcUrl: envValue("VORYN_SEQUENCER_FALLBACK_RPC_URL", ""),
        },
        rpcRequestTimeoutMs: envNumber("VORYN_SEQUENCER_RPC_REQUEST_TIMEOUT_MS", "5000"),
        delayBetweenTicksMs: envNumber("VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS", "100"),
        maxBlocksPerTick: envNumber("VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK", "10"),
    };
    const worker = await SequencerWorker.create(options);

    await runWorkerLifecycleWithFailure("sequencer", worker, createDevLogger());
}

runWithErrorHandling("sequencer", run);
