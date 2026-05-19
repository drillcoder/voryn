import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration transaction manager", () => {
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

    test("transaction manager rolls back a multi-table operation atomically", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const payload = buildFetchedBlock(600, hashFromNumber(599));

        await expect(
            transactionManager.run(async (transaction) => {
                await chainCursorRepository.insert({
                    chainId: CHAIN_ID,
                    lastEnqueuedBlock: 600,
                    lastCommittedBlock: 599,
                    lastCommittedHash: hashFromNumber(599),
                }, transaction);
                await blockJobsRepository.enqueueRange(CHAIN_ID, 600, 600, transaction);
                await blocksRepository.insert({
                    chainId: CHAIN_ID,
                    blockNumber: 600,
                    blockHash: payload.block.hash,
                    parentHash: payload.block.parentHash,
                    blockTimestamp: payload.block.timestamp,
                    fetchedAt: new Date(),
                }, transaction);
                await transactionsRepository.insertMany(payload.transactions, transaction);
                await eventsRepository.insertMany(payload.logs, transaction);
                throw new Error("force rollback");
            })
        ).rejects.toThrow("force rollback");

        await expect(db.countRows("chain_cursor")).resolves.toBe(0);
        await expect(db.countRows("block_jobs")).resolves.toBe(0);
        await expect(db.countRows("blocks")).resolves.toBe(0);
        await expect(db.countRows("transactions")).resolves.toBe(0);
        await expect(db.countRows("events")).resolves.toBe(0);
    });
});
