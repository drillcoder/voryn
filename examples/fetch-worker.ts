import { ConsoleLogger, FetchWorker, } from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";
const chainId = 1;
const delayBetweenTicksMs = 100;
const workerId = "fetch-worker-1";
const fetchBatchSize = 10;
const fetchClaimTtlMs = 125_000;
const retryMaxAttempts = 10;
const retryBaseDelayMs = 1_000;
const retryMaxDelayMs = 10_000;

const logger = new ConsoleLogger({ minLevel: "info" });
const config = {
    chainId,
    delayBetweenTicksMs,
    workerId,
    fetchBatchSize,
    fetchClaimTtlMs,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
};

const worker = FetchWorker.create({ config, logger, dbUrl, rpcUrl });

const shutdown = async (): Promise<void> => {
    await worker.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.start();
