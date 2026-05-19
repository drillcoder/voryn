import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { RetentionService } from "../../../src/services/retention-service.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration services: retention", () => {
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

    test("retention worker purges only blocks older than retention depth", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 10,
            lastCommittedHash: hashFromNumber(10),
        });

        await blockJobsRepository.enqueueRange(CHAIN_ID, 6, 8);
        for (const blockNumber of [6, 7, 8]) {
            const payload = buildFetchedBlock(blockNumber, hashFromNumber(blockNumber - 1));
            await blocksRepository.insert({
                chainId: CHAIN_ID,
                blockNumber,
                blockHash: payload.block.hash,
                parentHash: payload.block.parentHash,
                blockTimestamp: payload.block.timestamp,
                fetchedAt: new Date(),
            });
            await transactionsRepository.insertMany(payload.transactions);
            await eventsRepository.insertMany(payload.logs);
        }

        const service = new RetentionService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                retentionDepthBlocks: 3,
            },
            chainCursorRepository,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            transactionManager,
        );

        await service.execute();

        await expect(db.countRows("block_jobs", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("blocks", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("transactions", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("events", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("block_jobs", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("blocks", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("transactions", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("events", "block_number = 8")).resolves.toBe(1);
    });
});
