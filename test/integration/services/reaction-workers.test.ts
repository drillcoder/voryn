import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
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
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const block = buildFetchedBlock(500, hashFromNumber(499), 3);
        const handledEventIndexes: number[] = [];
        const handledTxIndexes: number[] = [];

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: block.block.number,
            lastCommittedBlock: block.block.number,
            lastCommittedHash: block.block.hash,
        });
        await transactionsRepository.insertMany(block.transactions);
        await eventsRepository.insertMany(block.logs);
        await workerCursorsRepository.insert(
            REACTION_WORKER_EVENT,
            CHAIN_ID,
            "event",
            { lastBlockNumber: 499, lastTransactionIndex: -1, lastLogIndex: -1 }
        );
        await workerCursorsRepository.insert(
            REACTION_WORKER_TX,
            CHAIN_ID,
            "tx",
            { lastBlockNumber: 499, lastTransactionIndex: -1 }
        );

        const eventHandler: EventReactionHandler = {
            async handle(event): Promise<void> {
                handledEventIndexes.push(event.index);
            },
        };
        const txHandler: TransactionReactionHandler = {
            async handle(transaction): Promise<void> {
                handledTxIndexes.push(transaction.index);
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
            chainCursorRepository,
            eventsRepository,
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
            chainCursorRepository,
            transactionsRepository,
            workerCursorsRepository,
        );

        await eventService.execute();
        await eventService.execute();
        await txService.execute();
        await txService.execute();

        expect(handledEventIndexes).toEqual([0, 1, 2]);
        expect(handledTxIndexes).toEqual([0, 1, 2]);

        const eventCursor = await workerCursorsRepository.get(REACTION_WORKER_EVENT, CHAIN_ID, "event");
        const txCursor = await workerCursorsRepository.get(REACTION_WORKER_TX, CHAIN_ID, "tx");
        expect(eventCursor?.position).toEqual({
            lastBlockNumber: 500,
            lastTransactionIndex: 2,
            lastLogIndex: 2,
        });
        expect(txCursor?.position).toEqual({
            lastBlockNumber: 500,
            lastTransactionIndex: 2,
            lastLogIndex: null,
        });
    });
});
