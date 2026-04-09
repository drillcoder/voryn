import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import {
    ConsoleLogger,
    EthersBlockSource,
    HeadWorker,
    PostgresBlockJobsRepository,
    PostgresChainCursorRepository,
    PostgresLeaderLock,
    PostgresRawBlocksRepository,
    PostgresTransactionManager,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";
const chainId = 1;
const delayBetweenTicksMs = 1_000;
const confirmations = 0;
const depthBlocks = 65_000;

const pool = new Pool({ connectionString: dbUrl });
const provider = new JsonRpcProvider(rpcUrl);

const blockSource = new EthersBlockSource({ provider, validateProviderChainId: true });
const chainCursorRepository = new PostgresChainCursorRepository(pool);
const blockJobsRepository = new PostgresBlockJobsRepository(pool);
const rawBlocksRepository = new PostgresRawBlocksRepository(pool);
const transactionManager = new PostgresTransactionManager(pool);
const leaderLock = new PostgresLeaderLock(pool, 10_000_000n + BigInt(chainId));
const logger = new ConsoleLogger({ minLevel: "info" });

const worker = new HeadWorker(
    { chainId, delayBetweenTicksMs, confirmations, depthBlocks },
    blockSource,
    chainCursorRepository,
    blockJobsRepository,
    rawBlocksRepository,
    transactionManager,
    leaderLock,
    logger
);

const shutdown = async (): Promise<void> => {
    await worker.stop();
    await pool.end();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await worker.start();
