import { PostgresLeaderLock } from "../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../src/repositories/postgres/raw-blocks-repository.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { RetentionWorker } from "../../src/workers/retention-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e retention boundary", () => {
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

    test("retention deletes only blocks older than boundary", async () => {
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

        const block10 = buildFetchedBlock(10, committedHash, 1);
        const block11 = buildFetchedBlock(11, block10.block.hash, 1);
        const block12 = buildFetchedBlock(12, block11.block.hash, 2);
        const block13 = buildFetchedBlock(13, block12.block.hash, 1);
        const source = createMapBlockSource(13, [block10, block11, block12, block13]);

        const headWorker = await HeadWorker.create({
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                rawBlocksRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_400_001n),
            },
        });
        const fetchWorker = await FetchWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                fetchBatchSize: 2,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 100,
            },
            source,
            overrides: {
                blockJobsRepository,
                rawBlocksRepository,
                transactionManager,
            },
        });
        const sequencerWorker = await SequencerWorker.create({
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 2 },
            source,
            overrides: {
                chainCursorRepository,
                rawBlocksRepository,
                canonicalBlocksRepository,
                canonicalTransactionsRepository,
                canonicalEventsRepository,
                blockJobsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_400_002n),
            },
        });
        const retentionWorker = await RetentionWorker.create({
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, retentionDepthBlocks: 2 },
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                rawBlocksRepository,
                canonicalBlocksRepository,
                canonicalTransactionsRepository,
                canonicalEventsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_400_003n),
            },
        });

        try {
            await headWorker.start();
            await fetchWorker.start();
            await sequencerWorker.start();

            await waitFor(async () => {
                const cursor = await chainCursorRepository.get(CHAIN_ID);
                return cursor?.lastCommittedBlock === 13;
            });

            await stopWorkers([headWorker, fetchWorker, sequencerWorker]);

            await retentionWorker.start();
            await waitFor(async () => {
                const oldCanonical = await db.countRows("canonical_blocks", "block_number <= 11");
                return oldCanonical === 0;
            });

            await expect(db.countRows("block_jobs", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("raw_blocks", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_blocks", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_transactions", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_events", "block_number <= 11")).resolves.toBe(0);

            await expect(db.countRows("block_jobs", "block_number >= 12")).resolves.toBe(2);
            await expect(db.countRows("raw_blocks", "block_number >= 12")).resolves.toBe(2);
            await expect(db.countRows("canonical_blocks", "block_number >= 12")).resolves.toBe(2);
            await expect(db.countRows("canonical_transactions", "block_number >= 12")).resolves.toBe(3);
            await expect(db.countRows("canonical_events", "block_number >= 12")).resolves.toBe(3);
        } finally {
            await stopWorkers([headWorker, fetchWorker, sequencerWorker, retentionWorker]);
        }
    });
});
