import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    createLeaderLock,
    createMapBlockSource,
    hashFromNumber,
} from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e concurrent fetch workers", () => {
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

    test("two fetch workers process one queue without duplicate claims", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const blocks = [
            buildFetchedBlock(10, committedHash, 1),
            buildFetchedBlock(11, hashFromNumber(10), 1),
            buildFetchedBlock(12, hashFromNumber(11), 1),
            buildFetchedBlock(13, hashFromNumber(12), 1),
            buildFetchedBlock(14, hashFromNumber(13), 1),
            buildFetchedBlock(15, hashFromNumber(14), 1),
            buildFetchedBlock(16, hashFromNumber(15), 1),
        ];
        const source = createMapBlockSource(16, blocks);

        const headWorker = await HeadWorker.create({
            logLevel: "error",
             chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 ,
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: createLeaderLock(),
            },
        });
        const fetchWorkerA = await FetchWorker.create({
            logLevel: "error",
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            fetchBatchSize: 2,
            fetchConcurrency: 1,
            fetchClaimTtlMs: 60_000,
            retryMaxAttempts: 3,
            retryBaseDelayMs: 10,
            retryMaxDelayMs: 100,
            source,
            overrides: {
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
            },
        });
        const fetchWorkerB = await FetchWorker.create({
            logLevel: "error",
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            fetchBatchSize: 2,
            fetchConcurrency: 1,
            fetchClaimTtlMs: 60_000,
            retryMaxAttempts: 3,
            retryBaseDelayMs: 10,
            retryMaxDelayMs: 100,
            source,
            overrides: {
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
            },
        });
        const sequencerWorker = await SequencerWorker.create({
            logLevel: "error",
             chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 3 ,
            source,
            overrides: {
                chainCursorRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                blockJobsRepository,
                transactionManager,
                leaderLock: createLeaderLock(),
            },
        });

        try {
            await headWorker.start();
            await fetchWorkerA.start();
            await fetchWorkerB.start();
            await sequencerWorker.start();

            await waitFor(async () => {
                const cursor = await chainCursorRepository.get(CHAIN_ID);
                return cursor?.lastCommittedBlock === 16;
            });

            const attemptsAboveOne = await db.pool.query<{ count: string }>(
                `SELECT COUNT(*)::TEXT AS count
                 FROM block_jobs
                 WHERE chain_id = $1
                   AND block_number BETWEEN 10 AND 16
                   AND attempts > 1`,
                [CHAIN_ID]
            );

            expect(Number(attemptsAboveOne.rows[0]?.count ?? "0")).toBe(0);
            await expect(
                db.countRows("block_jobs", "status = 'committed' AND block_number BETWEEN 10 AND 16")
            ).resolves.toBe(7);
            await expect(db.countRows("blocks", "block_number BETWEEN 10 AND 16")).resolves.toBe(7);
            await expect(db.countRows("transactions", "block_number BETWEEN 10 AND 16")).resolves.toBe(7);
            await expect(db.countRows("events", "block_number BETWEEN 10 AND 16")).resolves.toBe(7);
        } finally {
            await stopWorkers([headWorker, fetchWorkerA, fetchWorkerB, sequencerWorker]);
        }
    });
});
