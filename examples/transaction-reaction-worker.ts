import { Pool } from "pg";
import type { TransactionReactionHandler } from "voryn";
import {
    ConsoleLogger,
    PostgresCanonicalTransactionsRepository,
    PostgresLeaderLock,
    PostgresWorkerCursorsRepository,
    TransactionReactionWorker,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const workerName = "transaction-reaction-worker";
const delayBetweenTicksMs = 1_000;
const batchSize = 100;

const pool = new Pool({ connectionString: dbUrl });

const transactionsRepository = new PostgresCanonicalTransactionsRepository(pool);
const workerCursorsRepository = new PostgresWorkerCursorsRepository(pool);
const leaderLock = new PostgresLeaderLock(pool, 50_000_000n + BigInt(chainId));
const logger = new ConsoleLogger({ minLevel: "info" });

const handler: TransactionReactionHandler = {
    async handle(tx): Promise<void> {
        logger.info("transaction_received", {
            chainId,
            blockNumber: tx.blockNumber,
            hash: tx.hash,
            txIndex: tx.txIndex,
        });
    },
};

const worker = new TransactionReactionWorker(
    { chainId, delayBetweenTicksMs, workerName, batchSize },
    handler,
    transactionsRepository,
    workerCursorsRepository,
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
