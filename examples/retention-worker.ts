import { Pool } from "pg";
import {
    ConsoleLogger,
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresLeaderLock,
    PostgresRawBlocksRepository,
    PostgresTransactionManager,
    RetentionWorker,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const delayBetweenTicksMs = 60_000;
const retentionDepthBlocks = 65_000;

const pool = new Pool({ connectionString: dbUrl });

const chainCursorRepository = new PostgresChainCursorRepository(pool);
const blockJobsRepository = new PostgresBlockJobsRepository(pool);
const rawBlocksRepository = new PostgresRawBlocksRepository(pool);
const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(pool);
const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(pool);
const canonicalEventsRepository = new PostgresCanonicalEventsRepository(pool);
const transactionManager = new PostgresTransactionManager(pool);
const leaderLock = new PostgresLeaderLock(pool, 30_000_000n + BigInt(chainId));
const logger = new ConsoleLogger({ minLevel: "info" });

const worker = new RetentionWorker(
    { chainId, delayBetweenTicksMs, retentionDepthBlocks },
    chainCursorRepository,
    blockJobsRepository,
    rawBlocksRepository,
    canonicalBlocksRepository,
    canonicalTransactionsRepository,
    canonicalEventsRepository,
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
