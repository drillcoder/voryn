import type { CreateFetchWorkerOptions } from "@drillcoder/voryn";
import { FetchWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateFetchWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
        rpcUrl: "https://rpc.example.org",
        rpcRequestTimeoutMs: 30_000,
        delayBetweenTicksMs: 100,
        fetchBatchSize: 10,
        fetchConcurrency: 1,
        fetchClaimTtlMs: 125_000,
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 10_000,
    };

    const worker = await FetchWorker.create(options);

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
