import type { CreateHeadWorkerOptions } from "@drillcoder/voryn";
import { HeadWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateHeadWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
        rpcUrl: "https://rpc.example.org",
        delayBetweenTicksMs: 1_000,
        confirmations: 0,
        depthBlocks: 65_000,
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
