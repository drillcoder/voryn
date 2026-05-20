import type { BlockSource } from "../../../src/interfaces/block-source.js";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { FetchWorker } from "../../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

const idleSource: BlockSource = {
    getLatestBlockNumber: async () => 0,
    getLatestBlock: async () => {
        throw new Error("latest block is not expected in lifecycle tests");
    },
    getBlock: async () => {
        throw new Error("block is not expected in lifecycle tests");
    },
    getBlockData: async () => {
        throw new Error("block data is not expected in lifecycle tests");
    },
};

describe("integration workers: lifecycle and wiring", () => {
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

    test("fetch worker created via builder can start and stop", async () => {
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);

        const worker = await FetchWorker.create({
            config: {
                chainId: 1,
                delayBetweenTicksMs: 1,
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 10_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1000,
            },
            source: idleSource,
            overrides: {
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
            },
        });

        await worker.start();
        await worker.stop();
    });

    test("worker cannot be started again after stop", async () => {
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);

        const worker = await FetchWorker.create({
            config: {
                chainId: 1,
                delayBetweenTicksMs: 1,
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 10_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1000,
            },
            source: idleSource,
            overrides: {
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
            },
        });

        await worker.start();
        await worker.stop();

        await expect(worker.start()).rejects.toThrow(
            /^Worker "fetch:1:.+" cannot be started because its lifecycle is finalized$/
        );
    });

    test("singleton head workers respect leader lock", async () => {
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);
        const lockA = new PostgresLeaderLock(db.pool, 91_000_001n);
        const lockB = new PostgresLeaderLock(db.pool, 91_000_001n);

        const workerA = await HeadWorker.create({
            config: {
                chainId: 1,
                confirmations: 10,
                delayBetweenTicksMs: 1,
                depthBlocks: 64,
            },
            source: idleSource,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: lockA,
            },
        });
        const workerB = await HeadWorker.create({
            config: {
                chainId: 1,
                confirmations: 10,
                delayBetweenTicksMs: 1,
                depthBlocks: 64,
            },
            source: idleSource,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: lockB,
            },
        });

        await workerA.start();
        await expect(workerB.start()).rejects.toThrow('Worker "head:1" did not start: lock is already held');
        await workerA.stop();
    });
});
