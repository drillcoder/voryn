import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/worker-cursors-repository.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import type { PipelineBlock } from "../../../src/interfaces/pipeline.js";
import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration repositories: postgres", () => {
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

    test("repositories store normalized block data and read reactions by position", async () => {
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const blockNumber = 300;
        const parentHash = hashFromNumber(299);
        const block = buildFetchedBlock(blockNumber, parentHash, 2);

        await blocksRepository.insert(toPipelineBlock(block));
        await transactionsRepository.insertMany(block.transactions);
        await eventsRepository.insertMany(block.logs);

        const savedBlock = await blocksRepository.get(CHAIN_ID, blockNumber);
        const transactions = await transactionsRepository.listAfterPosition(CHAIN_ID, blockNumber, 0, -1, 10);
        const events = await eventsRepository.listAfterPosition(CHAIN_ID, blockNumber, 0, -1, -1, 10);

        expect(savedBlock?.blockHash).toBe(block.block.hash);
        expect(transactions.map((transaction) => transaction.index)).toEqual([0, 1]);
        expect(events.map((event) => event.index)).toEqual([0, 1]);
        await expect(db.countRows("blocks")).resolves.toBe(1);
        await expect(db.countRows("transactions")).resolves.toBe(2);
        await expect(db.countRows("events")).resolves.toBe(2);
    });

    test("worker cursor advance and reorg rewind are ordered by version", async () => {
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);

        await workerCursorsRepository.insert(
            "event-worker",
            CHAIN_ID,
            "event",
            { lastBlockNumber: 99, lastTransactionIndex: -1, lastLogIndex: -1 },
            0
        );
        await workerCursorsRepository.insert(
            "lagging-worker",
            CHAIN_ID,
            "transaction",
            { lastBlockNumber: 98, lastTransactionIndex: 3, lastLogIndex: -1 },
            0
        );

        await expect(workerCursorsRepository.advanceIfVersion(
            "event-worker",
            CHAIN_ID,
            "event",
            { lastBlockNumber: 101, lastTransactionIndex: 0, lastLogIndex: 0 },
            0
        )).resolves.toBe(true);

        await transactionManager.run(async (transaction) => {
            await expect(workerCursorsRepository.rewindForReorg(
                CHAIN_ID,
                100,
                1,
                transaction
            )).resolves.toBe(1);
        });

        await expect(workerCursorsRepository.get("event-worker", CHAIN_ID, "event")).resolves.toMatchObject({
            position: { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 },
            reorgVersion: 1,
        });
        await expect(
            workerCursorsRepository.get("lagging-worker", CHAIN_ID, "transaction")
        ).resolves.toMatchObject({
            position: { lastBlockNumber: 98, lastTransactionIndex: 3, lastLogIndex: -1 },
            reorgVersion: 1,
        });

        await expect(workerCursorsRepository.advanceIfVersion(
            "event-worker",
            CHAIN_ID,
            "event",
            { lastBlockNumber: 101, lastTransactionIndex: 0, lastLogIndex: 0 },
            0
        )).resolves.toBe(false);
        await expect(workerCursorsRepository.get("event-worker", CHAIN_ID, "event")).resolves.toMatchObject({
            position: { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 },
            reorgVersion: 1,
        });
    });

});

function toPipelineBlock(block: FetchedBlock): PipelineBlock {
    return {
        chainId: block.block.chainId,
        blockNumber: block.block.number,
        blockHash: block.block.hash,
        parentHash: block.block.parentHash,
        blockTimestamp: block.block.timestamp,
        fetchedAt: new Date("2026-04-08T01:00:00.000Z"),
    };
}
