import { ConsoleLogger, SequencerWorker } from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const delayBetweenTicksMs = 100;
const maxBlocksPerTick = 10;

const logger = new ConsoleLogger({ minLevel: "info" });
const config = { chainId, delayBetweenTicksMs, maxBlocksPerTick };

const worker = await SequencerWorker.create({ config, logger, dbUrl });

const shutdown = async (): Promise<void> => {
    await worker.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.start();
