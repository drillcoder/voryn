import type { CreateSequencerWorkerOptions } from "../src/index.js";
import { SequencerWorker } from "../src/index.js";
import {
    createDevLogger,
    envNumber,
    envValue,
    envValues,
    runWithErrorHandling,
    runWorkerLifecycleWithFailure,
} from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateSequencerWorkerOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        sourceConfig: {
            network: {
                chainId: envNumber("VORYN_CHAIN_ID", "0"),
                rpcUrls: envValues("VORYN_SEQUENCER_RPC_URLS", ""),
            },
            requestTimeoutMs: envNumber("VORYN_SEQUENCER_RPC_REQUEST_TIMEOUT_MS", "5000"),
            operationTimeoutMs: envNumber("VORYN_SEQUENCER_RPC_OPERATION_TIMEOUT_MS", "60000"),
        },
        delayBetweenTicksMs: envNumber("VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS", "100"),
        maxBlocksPerTick: envNumber("VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK", "10"),
    };
    const worker = await SequencerWorker.create(options);

    await runWorkerLifecycleWithFailure("sequencer", worker, createDevLogger());
}

runWithErrorHandling("sequencer", run);
