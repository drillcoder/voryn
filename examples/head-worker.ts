import { ConsoleLogger, HeadWorker } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const rpcUrl = "https://rpc.example.org";
    const chainId = 1;
    const delayBetweenTicksMs = 1_000;
    const confirmations = 0;
    const depthBlocks = 65_000;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const config = { chainId, delayBetweenTicksMs, confirmations, depthBlocks };

    const worker = await HeadWorker.create({ config, logger, dbUrl, rpcUrl });

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
