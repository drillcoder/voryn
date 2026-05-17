import { PostgresCanonicalBlocksRepository } from "../../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresRawBlocksRepository } from "../../../src/repositories/postgres/raw-blocks-repository.js";
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

    test("repositories keep idempotency and fetched block save uses upsert", async () => {
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const blockNumber = 300;
        const parentHash = hashFromNumber(299);
        const first = buildFetchedBlock(blockNumber, parentHash);
        const second = buildFetchedBlock(blockNumber, parentHash);
        second.block.hash = hashFromNumber(3300);

        await rawBlocksRepository.save({
            chainId: CHAIN_ID,
            blockNumber,
            blockHash: first.block.hash,
            parentHash: first.block.parentHash,
            payload: first,
            fetchedAt: new Date("2026-04-08T01:00:00.000Z"),
        });
        await rawBlocksRepository.save({
            chainId: CHAIN_ID,
            blockNumber,
            blockHash: second.block.hash,
            parentHash: second.block.parentHash,
            payload: second,
            fetchedAt: new Date("2026-04-08T01:01:00.000Z"),
        });

        await canonicalBlocksRepository.insert(first.block);
        await canonicalBlocksRepository.insert(first.block);
        await canonicalTransactionsRepository.insertMany(CHAIN_ID, blockNumber, first.block.hash, first.transactions);
        await canonicalTransactionsRepository.insertMany(CHAIN_ID, blockNumber, first.block.hash, first.transactions);
        await canonicalEventsRepository.insertMany(CHAIN_ID, blockNumber, first.block.hash, first.logs);
        await canonicalEventsRepository.insertMany(CHAIN_ID, blockNumber, first.block.hash, first.logs);

        const savedBlock = await rawBlocksRepository.get(CHAIN_ID, blockNumber);
        expect(savedBlock?.blockHash).toBe(second.block.hash);
        expect(savedBlock?.payload.block.hash).toBe(second.block.hash);
        await expect(db.countRows("raw_blocks")).resolves.toBe(1);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(1);
        await expect(db.countRows("canonical_transactions")).resolves.toBe(1);
        await expect(db.countRows("canonical_events")).resolves.toBe(1);
    });

    test("deleteAfterBlock removes rows above block number", async () => {
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const blocks = [
            buildFetchedBlock(300, hashFromNumber(299)),
            buildFetchedBlock(301, hashFromNumber(300)),
            buildFetchedBlock(302, hashFromNumber(301)),
        ];

        await blockJobsRepository.enqueueRange(CHAIN_ID, 300, 302);

        for (const block of blocks) {
            await rawBlocksRepository.save({
                chainId: CHAIN_ID,
                blockNumber: block.block.number,
                blockHash: block.block.hash,
                parentHash: block.block.parentHash,
                payload: block,
                fetchedAt: new Date("2026-04-08T01:00:00.000Z"),
            });
            await canonicalBlocksRepository.insert(block.block);
            await canonicalTransactionsRepository.insertMany(
                CHAIN_ID,
                block.block.number,
                block.block.hash,
                block.transactions
            );
            await canonicalEventsRepository.insertMany(CHAIN_ID, block.block.number, block.block.hash, block.logs);
        }

        await expect(blockJobsRepository.deleteAfterBlock(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(rawBlocksRepository.deleteAfterBlock(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(canonicalEventsRepository.deleteAfterBlock(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(canonicalTransactionsRepository.deleteAfterBlock(CHAIN_ID, 301)).resolves.toBe(1);
        await expect(canonicalBlocksRepository.deleteAfterBlock(CHAIN_ID, 301)).resolves.toBe(1);

        await expect(db.countRows("block_jobs")).resolves.toBe(2);
        await expect(db.countRows("raw_blocks")).resolves.toBe(2);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(2);
        await expect(db.countRows("canonical_transactions")).resolves.toBe(2);
        await expect(db.countRows("canonical_events")).resolves.toBe(2);
    });
});
