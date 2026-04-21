import { ConsoleLogger, RetentionWorker } from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const delayBetweenTicksMs = 60_000;
const retentionDepthBlocks = 65_000;

const logger = new ConsoleLogger({ minLevel: "info" });
const config = { chainId, delayBetweenTicksMs, retentionDepthBlocks };

const worker = RetentionWorker.create({ config, logger, dbUrl });

const shutdown = async (): Promise<void> => {
    await worker.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.start();
