import type { CreateSequencerWorkerOptions } from "@drillcoder/voryn";
import { SequencerWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateSequencerWorkerOptions = {
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
        delayBetweenTicksMs: 100,
        maxBlocksPerTick: 10,
    };

    const worker = await SequencerWorker.create(options);

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
