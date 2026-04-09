import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../../src/repositories/postgres/raw-blocks-repository.js";
import { buildFetchedBlock, CHAIN_ID, createLeaderLock, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import { TestRetentionWorker } from "../helpers/test-workers.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration workers: retention", () => {
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
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 10,
            lastCommittedBlock: 10,
            lastCommittedHash: hashFromNumber(10),
        });

        await blockJobsRepository.enqueueRange(CHAIN_ID, 6, 8);
        for (const blockNumber of [6, 7, 8]) {
            const payload = buildFetchedBlock(blockNumber, hashFromNumber(blockNumber - 1));
            await rawBlocksRepository.save({
                chainId: CHAIN_ID,
                blockNumber,
                blockHash: payload.block.hash,
                parentHash: payload.block.parentHash,
                payload,
                fetchedAt: new Date(),
            });
            await canonicalBlocksRepository.insert(payload.block);
            await canonicalTransactionsRepository.insertMany(
                CHAIN_ID,
                blockNumber,
                payload.block.hash,
                payload.transactions
            );
            await canonicalEventsRepository.insertMany(CHAIN_ID, blockNumber, payload.block.hash, payload.logs);
        }

        const worker = new TestRetentionWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                retentionDepthBlocks: 3,
            },
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
            transactionManager,
            createLeaderLock(),
        );

        await worker.runTick();

        await expect(db.countRows("block_jobs", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("raw_blocks", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("canonical_blocks", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("canonical_transactions", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("canonical_events", "block_number <= 7")).resolves.toBe(0);
        await expect(db.countRows("block_jobs", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("raw_blocks", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("canonical_blocks", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("canonical_transactions", "block_number = 8")).resolves.toBe(1);
        await expect(db.countRows("canonical_events", "block_number = 8")).resolves.toBe(1);
    });
});
