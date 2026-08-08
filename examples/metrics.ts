import type { CreatePipelineMetricsOptions } from "@drillcoder/voryn";
import { PipelineMetrics } from "@drillcoder/voryn";

(async () => {
    const options: CreatePipelineMetricsOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainIds: [1, 56],
        rpcConfigs: [
            {
                rpcUrl: "https://mainnet-rpc.example.org",
                fallbackRpcUrl: "https://mainnet-fallback-rpc.example.org",
            },
            {
                rpcUrl: "https://bsc-rpc.example.org",
                fallbackRpcUrl: "https://bsc-fallback-rpc.example.org",
            },
        ],
        rpcRequestTimeoutMs: 5_000,
    };

    const metrics = await PipelineMetrics.create(options);

    try {
        const snapshot = await metrics.get();

        console.log(JSON.stringify(snapshot, stringifyBigint, 2));
    } finally {
        await metrics.close();
    }
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

function stringifyBigint(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}
