import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import { PostgresCanonicalEventsRepository } from "../../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/worker-cursors-repository.js";
import { EventReactionService } from "../../../src/services/event-reaction-service.js";
import { TransactionReactionService } from "../../../src/services/transaction-reaction-service.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    hashFromNumber,
    REACTION_WORKER_EVENT,
    REACTION_WORKER_TX,
} from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration services: reaction", () => {
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

    test("event and transaction reaction services process batches and advance cursors", async () => {
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

        const eventService = new EventReactionService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_EVENT,
                batchSize: 2,
            },
            eventHandler,
            canonicalEventsRepository,
            workerCursorsRepository,
        );
        const txService = new TransactionReactionService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_TX,
                batchSize: 2,
            },
            txHandler,
            canonicalTransactionsRepository,
            workerCursorsRepository,
        );

        await eventService.execute();
        await eventService.execute();
        await txService.execute();
        await txService.execute();

        expect(handledEventSeqs).toEqual([1n, 2n, 3n]);
        expect(handledTxSeqs).toEqual([1n, 2n, 3n]);

        const eventCursor = await workerCursorsRepository.get(REACTION_WORKER_EVENT, CHAIN_ID, "event");
        const txCursor = await workerCursorsRepository.get(REACTION_WORKER_TX, CHAIN_ID, "tx");
        expect(eventCursor?.lastSeq).toBe(3n);
        expect(txCursor?.lastSeq).toBe(3n);
    });
});
