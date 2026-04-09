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
    SequencerWorker
} from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling, runWorkerLifecycle } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const delayBetweenTicksMs = envNumber("VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS", "100");
    const maxBlocksPerTick = envNumber("VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK", "10");

    const pool = new Pool({ connectionString: dbUrl });
    const worker = new SequencerWorker(
        { chainId, delayBetweenTicksMs, maxBlocksPerTick },
        new PostgresChainCursorRepository(pool),
        new PostgresRawBlocksRepository(pool),
        new PostgresCanonicalBlocksRepository(pool),
        new PostgresCanonicalTransactionsRepository(pool),
        new PostgresCanonicalEventsRepository(pool),
        new PostgresBlockJobsRepository(pool),
        new PostgresTransactionManager(pool),
        new PostgresLeaderLock(pool, 20_000_000n + BigInt(chainId)),
        logger,
    );

    await runWorkerLifecycle("sequencer", worker, logger, pool);
}

runWithErrorHandling("sequencer", run);
