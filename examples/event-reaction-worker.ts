import { Pool } from "pg";
import type { EventReactionHandler } from "voryn";
import {
    ConsoleLogger,
    EventReactionWorker,
    PostgresCanonicalEventsRepository,
    PostgresLeaderLock,
    PostgresWorkerCursorsRepository,
} from "voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const chainId = 1;
const workerName = "event-reaction-worker";
const delayBetweenTicksMs = 1_000;
const batchSize = 100;

const pool = new Pool({ connectionString: dbUrl });

const eventsRepository = new PostgresCanonicalEventsRepository(pool);
const workerCursorsRepository = new PostgresWorkerCursorsRepository(pool);
const leaderLock = new PostgresLeaderLock(pool, 40_000_000n + BigInt(chainId));
const logger = new ConsoleLogger({ minLevel: "info" });

const handler: EventReactionHandler = {
    async handle(event): Promise<void> {
        logger.info("event_received", {
            chainId,
            blockNumber: event.blockNumber,
            txHash: event.txHash,
            logIndex: event.logIndex,
        });
    },
};

const worker = new EventReactionWorker(
    { chainId, delayBetweenTicksMs, workerName, batchSize },
    handler,
    eventsRepository,
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
