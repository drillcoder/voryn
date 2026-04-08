import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import {
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresWorkerCursorsRepository,
} from "../../../src/repositories/postgres/index.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    createLeaderLock,
    REACTION_WORKER_EVENT,
    REACTION_WORKER_TX,
    hashFromNumber,
} from "../helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { TestEventReactionWorker, TestTransactionReactionWorker } from "../helpers/test-workers.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration workers: reaction", () => {
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

    test("event and transaction reaction workers process batches and advance cursors", async () => {
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const block = buildFetchedBlock(500, hashFromNumber(499), 3);
        const handledEventSeqs: bigint[] = [];
        const handledTxSeqs: bigint[] = [];

        await canonicalTransactionsRepository.insertMany(
            CHAIN_ID,
            block.block.number,
            block.block.hash,
            block.transactions
        );
        await canonicalEventsRepository.insertMany(CHAIN_ID, block.block.number, block.block.hash, block.logs);
        await workerCursorsRepository.insert(REACTION_WORKER_EVENT, CHAIN_ID, "event", 0n);
        await workerCursorsRepository.insert(REACTION_WORKER_TX, CHAIN_ID, "tx", 0n);

        const eventHandler: EventReactionHandler = {
            async handle(event): Promise<void> {
                handledEventSeqs.push(event.seq);
            },
        };
        const txHandler: TransactionReactionHandler = {
            async handle(transaction): Promise<void> {
                handledTxSeqs.push(transaction.seq);
            },
        };

        const eventWorker = new TestEventReactionWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_EVENT,
                batchSize: 2,
            },
            eventHandler,
            canonicalEventsRepository,
            workerCursorsRepository,
            createLeaderLock(),
        );
        const txWorker = new TestTransactionReactionWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_TX,
                batchSize: 2,
            },
            txHandler,
            canonicalTransactionsRepository,
            workerCursorsRepository,
            createLeaderLock(),
        );

        await eventWorker.runTick();
        await eventWorker.runTick();
        await txWorker.runTick();
        await txWorker.runTick();

        expect(handledEventSeqs).toEqual([1n, 2n, 3n]);
        expect(handledTxSeqs).toEqual([1n, 2n, 3n]);

        const eventCursor = await workerCursorsRepository.get(REACTION_WORKER_EVENT, CHAIN_ID, "event");
        const txCursor = await workerCursorsRepository.get(REACTION_WORKER_TX, CHAIN_ID, "tx");
        expect(eventCursor?.lastSeq).toBe(3n);
        expect(txCursor?.lastSeq).toBe(3n);
    });
});
