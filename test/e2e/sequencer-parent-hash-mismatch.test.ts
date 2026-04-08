import { PostgresLeaderLock, PostgresTransactionManager } from "../../src/postgres/index.js";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
} from "../../src/repositories/postgres/index.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e sequencer mismatch", () => {
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

    test("sequencer does not commit block when parent hash mismatches", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        const wrongParentHash = hashFromNumber(12345);
        const badBlock = buildFetchedBlock(10, wrongParentHash, 1);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const source = createMapBlockSource(10, [badBlock]);

        const headWorker = new HeadWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
            new PostgresLeaderLock(db.pool, 31_000_001n),
        );
        const fetchWorker = new FetchWorker(
            "fetch-worker-e2e-mismatch",
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                fetchBatchSize: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 100,
            },
            source,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
        );
        const sequencerWorker = new SequencerWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 1 },
            chainCursorRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
            blockJobsRepository,
            transactionManager,
            new PostgresLeaderLock(db.pool, 31_000_002n),
        );

        try {
            await headWorker.start();
            await fetchWorker.start();
            await sequencerWorker.start();

            await waitFor(async () => {
                const rawCount = await db.countRows("raw_blocks", "block_number = 10");
                return rawCount === 1;
            });

            await waitFor(async () => {
                const canonicalCount = await db.countRows("canonical_blocks");
                return canonicalCount === 0;
            });

            const cursor = await chainCursorRepository.get(CHAIN_ID);
            expect(cursor?.lastCommittedBlock).toBe(9);
            expect(cursor?.lastCommittedHash).toBe(committedHash);
            await expect(db.countRows("block_jobs", "status = 'fetched' AND block_number = 10")).resolves.toBe(1);
            await expect(db.countRows("canonical_transactions")).resolves.toBe(0);
            await expect(db.countRows("canonical_events")).resolves.toBe(0);
        } finally {
            await stopWorkers([headWorker, fetchWorker, sequencerWorker]);
        }
    });
});
