import type { EventReactionHandler, TransactionReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresLeaderLock } from "../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../src/repositories/postgres/worker-cursors-repository.js";
import { EventReactionWorker } from "../../src/workers/event-reaction-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { TransactionReactionWorker } from "../../src/workers/transaction-reaction-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e startup from empty state", () => {
    let db: IsolatedDbContext;

    beforeAll(async () => {
        db = await createIsolatedDbContext(DATABASE_URL);
    });

    beforeEach(async () => {
        await db.truncatePipelineTables();
    });

    afterAll(async () => {
        await db.close();
    });

    test("head initializes chain cursor and reaction workers bootstrap cursors", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);

        const latestBlock = buildFetchedBlock(20, hashFromNumber(19), 0);
        const source = createMapBlockSource(20, [latestBlock]);

        const eventHandler: EventReactionHandler = async (): Promise<"processed"> => "processed";
        const transactionHandler: TransactionReactionHandler = async (): Promise<"processed"> => "processed";

        const headWorker = await HeadWorker.create({
            logLevel: "error",
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_300_001n),
            },
        });
        const eventWorker = await EventReactionWorker.create({
            logLevel: "error",
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: "reaction-event-startup",
                batchSize: 5,
                skipFlushInterval: 5,
            },
            handler: eventHandler,
            overrides: {
                chainCursorRepository,
                eventsRepository,
                workerCursorsRepository,
                leaderLock: new PostgresLeaderLock(db.pool, 31_300_002n),
            },
        });
        const transactionWorker = await TransactionReactionWorker.create({
            logLevel: "error",
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: "reaction-transaction-startup",
                batchSize: 5,
                skipFlushInterval: 5,
            },
            handler: transactionHandler,
            overrides: {
                chainCursorRepository,
                transactionsRepository,
                workerCursorsRepository,
                leaderLock: new PostgresLeaderLock(db.pool, 31_300_003n),
            },
        });

        try {
            await headWorker.start();
            await eventWorker.start();
            await transactionWorker.start();

            await waitFor(async () => {
                const chainCursor = await chainCursorRepository.get(CHAIN_ID);
                if (chainCursor === null) {
                    return false;
                }

                const eventCursor = await workerCursorsRepository.get("reaction-event-startup", CHAIN_ID, "event");
                const transactionCursor = await workerCursorsRepository.get(
                    "reaction-transaction-startup",
                    CHAIN_ID,
                    "transaction"
                );
                return eventCursor !== null && transactionCursor !== null;
            });

            const chainCursor = await chainCursorRepository.get(CHAIN_ID);
            expect(chainCursor?.lastCommittedBlock).toBe(20);
            expect(chainCursor?.lastEnqueuedBlock).toBe(20);
            expect(chainCursor?.lastCommittedHash).toBe(latestBlock.block.hash);

            const eventCursor = await workerCursorsRepository.get("reaction-event-startup", CHAIN_ID, "event");
            const transactionCursor = await workerCursorsRepository.get(
                "reaction-transaction-startup",
                CHAIN_ID,
                "transaction"
            );
            expect(eventCursor?.position).toEqual({
                lastBlockNumber: 20,
                lastTransactionIndex: -1,
                lastLogIndex: -1,
            });
            expect(transactionCursor?.position).toEqual({
                lastBlockNumber: 20,
                lastTransactionIndex: -1,
                lastLogIndex: null,
            });
            await expect(db.countRows("block_jobs")).resolves.toBe(0);
        } finally {
            await stopWorkers([headWorker, eventWorker, transactionWorker]);
        }
    });
});
