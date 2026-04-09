import { Pool } from "pg";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresLeaderLock,
    PostgresRawBlocksRepository,
    PostgresTransactionManager,
    RetentionWorker
} from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS", "60000");
    const retentionDepthBlocks = envNumber("VORYN_RETENTION_DEPTH_BLOCKS", "65000");

    const pool = new Pool({ connectionString: dbUrl });
    const worker = new RetentionWorker(
        { chainId, delayBetweenTicksMs, retentionDepthBlocks },
        new PostgresChainCursorRepository(pool),
        new PostgresBlockJobsRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresCanonicalBlocksRepository(pool),
        new PostgresCanonicalTransactionsRepository(pool),
        new PostgresCanonicalEventsRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 30_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("retention", worker, logger, pool);
}

runWithErrorHandling("retention", run);
