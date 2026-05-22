import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/worker-cursors-repository.js";
import { ReactionService } from "../../../src/services/reaction-service.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    hashFromNumber,
    REACTION_WORKER_EVENT,
    REACTION_WORKER_TRANSACTION,
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
            REACTION_WORKER_TRANSACTION,
            CHAIN_ID,
            "transaction",
            { lastBlockNumber: 499, lastTransactionIndex: -1 }
        );

        const eventHandler: EventReactionHandler = async (event): Promise<"processed"> => {
            handledEventIndexes.push(event.index);

            return "processed";
        };
        const transactionHandler: TransactionReactionHandler = async (transaction): Promise<"processed"> => {
            handledTxIndexes.push(transaction.index);

            return "processed";
        };

        const eventService = new ReactionService({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_EVENT,
                batchSize: 2,
                skipFlushInterval: 2,
            },
            streamType: "event",
            handler: eventHandler,
            chainCursorRepository,
            eventsRepository,
            workerCursorsRepository,
        });
        const transactionService = new ReactionService({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_TRANSACTION,
                batchSize: 2,
                skipFlushInterval: 2,
            },
            streamType: "transaction",
            handler: transactionHandler,
            chainCursorRepository,
            transactionsRepository,
            workerCursorsRepository,
        });

        await eventService.execute();
        await eventService.execute();
        await transactionService.execute();
        await transactionService.execute();

        expect(handledEventIndexes).toEqual([0, 1, 2]);
        expect(handledTxIndexes).toEqual([0, 1, 2]);

        const eventCursor = await workerCursorsRepository.get(REACTION_WORKER_EVENT, CHAIN_ID, "event");
        const transactionCursor = await workerCursorsRepository.get(
            REACTION_WORKER_TRANSACTION,
            CHAIN_ID,
            "transaction"
        );
        expect(eventCursor?.position).toEqual({
            lastBlockNumber: 500,
            lastTransactionIndex: 2,
            lastLogIndex: 2,
        });
        expect(transactionCursor?.position).toEqual({
            lastBlockNumber: 500,
            lastTransactionIndex: 2,
            lastLogIndex: null,
        });
    });
});
