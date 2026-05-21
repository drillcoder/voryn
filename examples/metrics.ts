import { ConsoleLogger, PipelineMetrics } from "@drillcoder/voryn";

(async () => {
    const config = {
        chainId: 1,
    };
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const rpcUrl = "https://rpc.example.org";

    const metrics = await PipelineMetrics.create({ config, logger, dbUrl, rpcUrl });

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
