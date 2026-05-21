import { ConsoleLogger, RetentionWorker } from "@drillcoder/voryn";

(async () => {
    const config = {
        chainId: 1,
        delayBetweenTicksMs: 60_000,
        retentionDepthBlocks: 65_000,
    };
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";

    const worker = await RetentionWorker.create({ config, logger, dbUrl });

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
