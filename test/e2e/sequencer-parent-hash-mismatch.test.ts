import { PostgresLeaderLock } from "../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
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
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        const wrongParentHash = hashFromNumber(12345);
        const committedBlock = buildFetchedBlock(9, hashFromNumber(8), 0);
        const badBlock = buildFetchedBlock(10, wrongParentHash, 1);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });
        await blocksRepository.insert({
            chainId: CHAIN_ID,
            blockNumber: committedBlock.block.number,
            blockHash: committedBlock.block.hash,
            parentHash: committedBlock.block.parentHash,
            blockTimestamp: committedBlock.block.timestamp,
            fetchedAt: new Date(),
        });

        const source = createMapBlockSource(10, [committedBlock, badBlock]);

        const headWorker = await HeadWorker.create({
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_000_001n),
            },
        });
        const fetchWorker = await FetchWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                fetchBatchSize: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 100,
            },
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
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 1 },
            source,
            overrides: {
                chainCursorRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                blockJobsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_000_002n),
            },
        });

        try {
            await headWorker.start();
            await fetchWorker.start();

            await waitFor(async () => {
                const blockCount = await db.countRows("blocks", "block_number = 10");
                return blockCount === 1;
            });

            await headWorker.stop();
            await fetchWorker.stop();
            await sequencerWorker.start();

            await waitFor(async () => {
                const blockCount = await db.countRows("blocks", "block_number = 10");
                return blockCount === 0;
            });

            const cursor = await chainCursorRepository.get(CHAIN_ID);
            expect(cursor?.lastCommittedBlock).toBe(9);
            expect(cursor?.lastCommittedHash).toBe(committedHash);
            await expect(db.countRows("block_jobs", "status = 'committed' AND block_number = 10")).resolves.toBe(0);
            await expect(db.countRows("transactions")).resolves.toBe(0);
            await expect(db.countRows("events")).resolves.toBe(0);
        } finally {
            await stopWorkers([headWorker, fetchWorker, sequencerWorker]);
        }
    });
});
