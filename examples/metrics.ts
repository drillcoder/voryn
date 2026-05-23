import type { CreatePipelineMetricsOptions } from "@drillcoder/voryn";
import { PipelineMetrics } from "@drillcoder/voryn";

(async () => {
    const options: CreatePipelineMetricsOptions = {
        chainIds: [1, 56],
        rpcUrls: [
            "https://mainnet-rpc.example.org",
            "https://bsc-rpc.example.org",
        ],
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
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
