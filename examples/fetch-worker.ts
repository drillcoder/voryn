import { ConsoleLogger, FetchWorker } from "@drillcoder/voryn";

(async () => {
    const config = {
        chainId: 1,
        delayBetweenTicksMs: 100,
        fetchBatchSize: 10,
        fetchConcurrency: 1,
        fetchClaimTtlMs: 125_000,
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 10_000,
    };
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const rpcUrl = "https://rpc.example.org";

    const worker = await FetchWorker.create({ config, logger, dbUrl, rpcUrl });

    const shutdown = async (): Promise<void> => {
        await worker.stop();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await worker.start();
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
