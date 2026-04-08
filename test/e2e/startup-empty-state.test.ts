import type { EventReactionHandler, TransactionReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresLeaderLock, PostgresTransactionManager } from "../../src/postgres/index.js";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
    PostgresWorkerCursorsRepository,
} from "../../src/repositories/postgres/index.js";
import { EventReactionWorker } from "../../src/workers/event-reaction-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { TransactionReactionWorker } from "../../src/workers/transaction-reaction-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
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
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);

        const latestBlock = buildFetchedBlock(20, hashFromNumber(19), 0);
        const source = createMapBlockSource(20, [latestBlock]);

        const eventHandler: EventReactionHandler = {
            async handle(): Promise<void> {
                return undefined;
            },
        };
        const txHandler: TransactionReactionHandler = {
            async handle(): Promise<void> {
                return undefined;
            },
        };

        const headWorker = new HeadWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
            new PostgresLeaderLock(db.pool, 31_300_001n),
        );
        const eventWorker = new EventReactionWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, workerName: "reaction-event-startup", batchSize: 5 },
            eventHandler,
            canonicalEventsRepository,
            workerCursorsRepository,
            new PostgresLeaderLock(db.pool, 31_300_002n),
        );
        const txWorker = new TransactionReactionWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, workerName: "reaction-tx-startup", batchSize: 5 },
            txHandler,
            canonicalTransactionsRepository,
            workerCursorsRepository,
            new PostgresLeaderLock(db.pool, 31_300_003n),
        );

        try {
            await headWorker.start();
            await eventWorker.start();
            await txWorker.start();

            await waitFor(async () => {
                const chainCursor = await chainCursorRepository.get(CHAIN_ID);
                if (chainCursor === null) {
                    return false;
                }

                const eventCursor = await workerCursorsRepository.get("reaction-event-startup", CHAIN_ID, "event");
                const txCursor = await workerCursorsRepository.get("reaction-tx-startup", CHAIN_ID, "tx");
                return eventCursor !== null && txCursor !== null;
            });

            const chainCursor = await chainCursorRepository.get(CHAIN_ID);
            expect(chainCursor?.lastCommittedBlock).toBe(20);
            expect(chainCursor?.lastEnqueuedBlock).toBe(20);
            expect(chainCursor?.lastCommittedHash).toBe(latestBlock.block.hash);

            const eventCursor = await workerCursorsRepository.get("reaction-event-startup", CHAIN_ID, "event");
            const txCursor = await workerCursorsRepository.get("reaction-tx-startup", CHAIN_ID, "tx");
            expect(eventCursor?.lastSeq).toBe(0n);
            expect(txCursor?.lastSeq).toBe(0n);
            await expect(db.countRows("block_jobs")).resolves.toBe(0);
        } finally {
            await stopWorkers([headWorker, eventWorker, txWorker]);
        }
    });
});
