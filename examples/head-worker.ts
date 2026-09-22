import type { HeadWorkerOptions } from "@drillcoder/voryn";
import { HeadWorker } from "@drillcoder/voryn";

(async () => {
    const options: HeadWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        sourceConfig: {
            network: {
                chainId: 1,
                rpcUrls: ["https://rpc.example.org", "https://fallback-rpc.example.org"],
            },
            requestTimeoutMs: 5_000,
            operationTimeoutMs: 60_000,
        },
        delayBetweenTicksMs: 1_000,
        confirmations: 0,
        depthBlocks: 65_000,
    };

    const worker = await HeadWorker.create(options);

    worker.onFailure((error) => {
        console.error(error);
        process.exitCode = 1;
    });

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
