import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

import type { EventReactionHandler, TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
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
        const transactionManager = new PostgresTransactionManager(db.pool);
        const block = buildFetchedBlock(500, hashFromNumber(499), 3);
        const handledEventIndexes: number[] = [];
        const handledTxIndexes: number[] = [];

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: block.block.number,
            lastCommittedBlock: block.block.number,
            lastCommittedHash: block.block.hash,
            reorgVersion: 0,
        });
        await transactionsRepository.insertMany(block.transactions);
        await eventsRepository.insertMany(block.logs);
        await workerCursorsRepository.insert(
            REACTION_WORKER_EVENT,
            CHAIN_ID,
            "event",
            { lastBlockNumber: 499, lastTransactionIndex: -1, lastLogIndex: -1 },
            0
        );
        await workerCursorsRepository.insert(
            REACTION_WORKER_TRANSACTION,
            CHAIN_ID,
            "transaction",
            { lastBlockNumber: 499, lastTransactionIndex: -1, lastLogIndex: -1 },
            0
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
                confirmations: 0,
            },
            streamType: "event",
            handler: eventHandler,
            chainCursorRepository,
            eventsRepository,
            workerCursorsRepository,
            transactionManager,
        });
        const transactionService = new ReactionService({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_TRANSACTION,
                batchSize: 2,
                skipFlushInterval: 2,
                confirmations: 0,
            },
            streamType: "transaction",
            handler: transactionHandler,
            chainCursorRepository,
            transactionsRepository,
            workerCursorsRepository,
            transactionManager,
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
            lastLogIndex: -1,
        });
    });

    test("transaction reaction receives a replacement branch at the same position", async () => {
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);
        const oldBlock = buildFetchedBlock(501, hashFromNumber(500));
        const handledHashes: string[] = [];

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 501,
            lastCommittedBlock: 501,
            lastCommittedHash: oldBlock.block.hash,
            reorgVersion: 0,
        });
        await transactionsRepository.insertMany(oldBlock.transactions);
        await workerCursorsRepository.insert(
            REACTION_WORKER_TRANSACTION,
            CHAIN_ID,
            "transaction",
            { lastBlockNumber: 500, lastTransactionIndex: -1, lastLogIndex: -1 },
            0
        );

        const service = new ReactionService({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                workerName: REACTION_WORKER_TRANSACTION,
                batchSize: 10,
                skipFlushInterval: 2,
                confirmations: 0,
            },
            streamType: "transaction",
            handler: async (transaction) => {
                handledHashes.push(transaction.hash);
                return "processed";
            },
            chainCursorRepository,
            transactionsRepository,
            workerCursorsRepository,
            transactionManager,
        });

        await service.execute();

        await transactionManager.run(async (transaction) => {
            await transactionsRepository.deleteBlockNumberRange(CHAIN_ID, 501, 501, transaction);
            const reorgVersion = await chainCursorRepository.setPositionsAndIncrementReorgVersion(
                CHAIN_ID,
                500,
                hashFromNumber(500),
                500,
                transaction
            );
            await workerCursorsRepository.rewindForReorg(CHAIN_ID, 501, reorgVersion, transaction);
        });

        const replacementBlockHash = hashFromNumber(50_001);
        const replacementTransactionHash = hashFromNumber(50_100);
        await transactionsRepository.insertMany(oldBlock.transactions.map((transaction) => ({
            ...transaction,
            blockHash: replacementBlockHash,
            hash: replacementTransactionHash,
        })));
        await chainCursorRepository.setPositions(CHAIN_ID, 501, replacementBlockHash, 501);

        await service.execute();

        expect(handledHashes).toEqual([
            oldBlock.transactions[0]?.hash,
            replacementTransactionHash,
        ]);
        await expect(
            workerCursorsRepository.get(REACTION_WORKER_TRANSACTION, CHAIN_ID, "transaction")
        ).resolves.toMatchObject({
            position: { lastBlockNumber: 501, lastTransactionIndex: 0, lastLogIndex: -1 },
            reorgVersion: 1,
        });
    });
});
