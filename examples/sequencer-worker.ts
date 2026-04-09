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
    SequencerWorker,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const delayBetweenTicksMs = 100;
const maxBlocksPerTick = 10;

const pool = new Pool({ connectionString: dbUrl });

const chainCursorRepository = new PostgresChainCursorRepository(pool);
const rawBlocksRepository = new PostgresRawBlocksRepository(pool);
const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(pool);
const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(pool);
const canonicalEventsRepository = new PostgresCanonicalEventsRepository(pool);
const blockJobsRepository = new PostgresBlockJobsRepository(pool);
const transactionManager = new PostgresTransactionManager(pool);
const leaderLock = new PostgresLeaderLock(pool, 20_000_000n + BigInt(chainId));
const logger = new ConsoleLogger({ minLevel: "info" });

const worker = new SequencerWorker(
    { chainId, delayBetweenTicksMs, maxBlocksPerTick },
    chainCursorRepository,
    rawBlocksRepository,
    canonicalBlocksRepository,
    canonicalTransactionsRepository,
    canonicalEventsRepository,
    blockJobsRepository,
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
