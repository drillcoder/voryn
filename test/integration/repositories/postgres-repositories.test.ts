import {
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresRawBlocksRepository,
} from "../../../src/repositories/postgres/index.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";

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

    test("repositories keep idempotency and raw block save uses upsert", async () => {
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const blockNumber = 300;
        const parentHash = hashFromNumber(299);
        const first = buildFetchedBlock(blockNumber, parentHash);
        const second = buildFetchedBlock(blockNumber, parentHash);
        second.block.hash = hashFromNumber(3300);
        second.block.raw = { source: "upserted" };

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

        const raw = await rawBlocksRepository.get(CHAIN_ID, blockNumber);
        expect(raw?.blockHash).toBe(second.block.hash);
        expect(raw?.payload.block.raw).toEqual({ source: "upserted" });
        await expect(db.countRows("raw_blocks")).resolves.toBe(1);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(1);
        await expect(db.countRows("canonical_transactions")).resolves.toBe(1);
        await expect(db.countRows("canonical_events")).resolves.toBe(1);
    });
});
