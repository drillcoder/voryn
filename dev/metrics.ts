import type { CreatePipelineMetricsOptions } from "../src/index.js";
import { PipelineMetrics } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreatePipelineMetricsOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainIds: [envNumber("VORYN_CHAIN_ID", "0")],
        rpcConfigs: [{
            rpcUrl: envValue("VORYN_METRICS_RPC_URL", ""),
            fallbackRpcUrl: envValue("VORYN_METRICS_FALLBACK_RPC_URL", ""),
        }],
        rpcRequestTimeoutMs: envNumber("VORYN_METRICS_RPC_REQUEST_TIMEOUT_MS", "5000"),
    };
    const metrics = await PipelineMetrics.create(options);

    try {
        const snapshot = await metrics.get();

        console.log(JSON.stringify(snapshot, stringifyBigint, 2));
    } finally {
        await metrics.close();
    }
}

function stringifyBigint(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}

runWithErrorHandling("metrics", run);
