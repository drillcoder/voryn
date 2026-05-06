import { PipelineMetrics } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const rpcUrl = envValue("VORYN_METRICS_RPC_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const confirmations = envNumber("VORYN_METRICS_CONFIRMATIONS", "0");

    const config = { chainId, confirmations };
    const metrics = await PipelineMetrics.create({ config, logger, dbUrl, rpcUrl });

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
