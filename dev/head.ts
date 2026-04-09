import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import {
    EthersBlockSource,
    HeadWorker,
    PostgresBlockJobsRepository,
    PostgresChainCursorRepository,
    PostgresLeaderLock,
    PostgresRawBlocksRepository,
    PostgresTransactionManager
} from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const rpcUrl = envValue("VORYN_HEAD_RPC_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_HEAD_DELAY_BETWEEN_TICKS_MS", "1000");
    const confirmations = envNumber("VORYN_HEAD_CONFIRMATIONS", "0");
    const depthBlocks = envNumber("VORYN_HEAD_DEPTH_BLOCKS", "65000");

    const pool = new Pool({ connectionString: dbUrl });
    const worker = new HeadWorker(
        { chainId, delayBetweenTicksMs, confirmations, depthBlocks },
        new EthersBlockSource({ provider: new JsonRpcProvider(rpcUrl), validateProviderChainId: true }),
        new PostgresChainCursorRepository(pool),
        new PostgresBlockJobsRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 10_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("head", worker, logger, pool);
}

runWithErrorHandling("head", run);
