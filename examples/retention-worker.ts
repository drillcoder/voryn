import type { CreateRetentionWorkerOptions } from "@drillcoder/voryn";
import { RetentionWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateRetentionWorkerOptions = {
        chainId: 1,
        delayBetweenTicksMs: 60_000,
        retentionDepthBlocks: 65_000,
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
    };

    const worker = await RetentionWorker.create(options);

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
