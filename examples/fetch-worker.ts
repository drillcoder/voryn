import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import {
    ConsoleLogger,
    EthersBlockSource,
    FetchWorker,
    PostgresBlockJobsRepository,
    PostgresRawBlocksRepository,
    PostgresTransactionManager,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";
const chainId = 1;
const workerId = "fetch-worker-1";
const delayBetweenTicksMs = 100;
const fetchBatchSize = 10;
const fetchClaimTtlMs = 125_000;
const retryMaxAttempts = 10;
const retryBaseDelayMs = 1_000;
const retryMaxDelayMs = 10_000;

const pool = new Pool({ connectionString: dbUrl });
const provider = new JsonRpcProvider(rpcUrl);

const blockSource = new EthersBlockSource({ provider, validateProviderChainId: true });
const blockJobsRepository = new PostgresBlockJobsRepository(pool);
const rawBlocksRepository = new PostgresRawBlocksRepository(pool);
const transactionManager = new PostgresTransactionManager(pool);
const logger = new ConsoleLogger({ minLevel: "info" });

const worker = new FetchWorker(
    workerId,
    {
        chainId,
        delayBetweenTicksMs,
        fetchBatchSize,
        fetchClaimTtlMs,
        retryMaxAttempts,
        retryBaseDelayMs,
        retryMaxDelayMs,
    },
    blockSource,
    blockJobsRepository,
    rawBlocksRepository,
    transactionManager,
    logger
);

const shutdown = async (): Promise<void> => {
    await worker.stop();
    await pool.end();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.start();
