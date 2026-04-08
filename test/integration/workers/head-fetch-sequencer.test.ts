import { PostgresTransactionManager } from "../../../src/postgres/index.js";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
} from "../../../src/repositories/postgres/index.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    createLeaderLock,
    createMapBlockSource,
    hashFromNumber,
    WORKER_ID,
} from "../helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { TestFetchWorker, TestHeadWorker, TestSequencerWorker } from "../helpers/test-workers.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration workers: head/fetch/sequencer", () => {
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

    test("head -> fetch -> sequencer commits a contiguous block range", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const block10 = buildFetchedBlock(10, committedHash);
        const block11 = buildFetchedBlock(11, block10.block.hash);
        const block12 = buildFetchedBlock(12, block11.block.hash);
        const source = createMapBlockSource(12, [block10, block11, block12]);

        const headWorker = new TestHeadWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                confirmations: 0,
                depthBlocks: 64,
            },
            source,
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
            createLeaderLock(),
        );

        const fetchWorker = new TestFetchWorker(
            WORKER_ID,
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                fetchBatchSize: 10,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1_000,
            },
            source,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
        );

        const sequencerWorker = new TestSequencerWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                maxBlocksPerTick: 10,
            },
            chainCursorRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
            blockJobsRepository,
            transactionManager,
            createLeaderLock(),
        );

        await headWorker.runTick();
        await fetchWorker.runTick();
        await sequencerWorker.runTick();

        const cursor = await chainCursorRepository.get(CHAIN_ID);
        expect(cursor?.lastCommittedBlock).toBe(12);
        expect(cursor?.lastCommittedHash).toBe(block12.block.hash);

        await expect(db.countRows("block_jobs", "status = 'committed'")).resolves.toBe(3);
        await expect(db.countRows("raw_blocks")).resolves.toBe(3);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(3);
        await expect(db.countRows("canonical_transactions")).resolves.toBe(3);
        await expect(db.countRows("canonical_events")).resolves.toBe(3);
    });

    test("sequencer rejects parent hash mismatch and keeps state unchanged", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const committedHash = hashFromNumber(399);
        const wrongParentHash = hashFromNumber(12345);
        const block = buildFetchedBlock(400, wrongParentHash);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 400,
            lastCommittedBlock: 399,
            lastCommittedHash: committedHash,
        });
        await blockJobsRepository.enqueueRange(CHAIN_ID, 400, 400);
        await rawBlocksRepository.save({
            chainId: CHAIN_ID,
            blockNumber: 400,
            blockHash: block.block.hash,
            parentHash: block.block.parentHash,
            payload: block,
            fetchedAt: new Date(),
        });

        const sequencerWorker = new TestSequencerWorker(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                maxBlocksPerTick: 1,
            },
            chainCursorRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
            blockJobsRepository,
            transactionManager,
            createLeaderLock(),
        );

        await expect(sequencerWorker.runTick()).rejects.toThrow("Raw block parent hash mismatch");

        const cursor = await chainCursorRepository.get(CHAIN_ID);
        expect(cursor?.lastCommittedBlock).toBe(399);
        expect(cursor?.lastCommittedHash).toBe(committedHash);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(0);
        await expect(db.countRows("canonical_transactions")).resolves.toBe(0);
        await expect(db.countRows("canonical_events")).resolves.toBe(0);
        await expect(db.countRows("block_jobs", "status = 'pending'")).resolves.toBe(1);
    });
});
