import type { CreateHeadWorkerOptions } from "@drillcoder/voryn";
import { HeadWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateHeadWorkerOptions = {
        config: {
            chainId: 1,
            delayBetweenTicksMs: 1_000,
            confirmations: 0,
            depthBlocks: 65_000,
        },
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        rpcUrl: "https://rpc.example.org",
    };

    const worker = await HeadWorker.create(options);

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
