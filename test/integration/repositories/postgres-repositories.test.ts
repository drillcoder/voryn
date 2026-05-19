import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
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

    test("deleteAfterBlockNumber removes rows above block number", async () => {
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const blocks = [
            buildFetchedBlock(300, hashFromNumber(299)),
            buildFetchedBlock(301, hashFromNumber(300)),
            buildFetchedBlock(302, hashFromNumber(301)),
        ];

        await blockJobsRepository.enqueueRange(CHAIN_ID, 300, 302);

        for (const block of blocks) {
            await blocksRepository.insert(toPipelineBlock(block));
            await transactionsRepository.insertMany(block.transactions);
            await eventsRepository.insertMany(block.logs);
        }

        await expect(blockJobsRepository.deleteAfterBlockNumber(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(eventsRepository.deleteAfterBlockNumber(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(transactionsRepository.deleteAfterBlockNumber(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(blocksRepository.deleteAfterBlockNumber(CHAIN_ID, 301)).resolves.toBe(1);

        await expect(db.countRows("block_jobs")).resolves.toBe(2);
        await expect(db.countRows("blocks")).resolves.toBe(2);
        await expect(db.countRows("transactions")).resolves.toBe(2);
        await expect(db.countRows("events")).resolves.toBe(2);
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
