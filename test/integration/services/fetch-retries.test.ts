import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { FetchService } from "../../../src/services/fetch-service.js";
import { buildFetchedBlock, CHAIN_ID, FETCH_INSTANCE_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration services: fetch retries", () => {
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

    test("fetch worker retries failed jobs and then fetches successfully", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const targetBlock = 200;
        const payload = buildFetchedBlock(targetBlock, hashFromNumber(199));
        let calls = 0;

        await blockJobsRepository.enqueueRange(CHAIN_ID, targetBlock, targetBlock);

        const source: BlockSource = {
            async getLatestBlockNumber(): Promise<number> {
                return targetBlock;
            },
            async getLatestBlock() {
                return payload.block;
            },
            async getBlock() {
                return payload.block;
            },
            async getBlockData(): Promise<FetchedBlock> {
                calls += 1;
                if (calls === 1) {
                    throw new Error("rpc timeout");
                }

                return payload;
            },
        };

        const service = new FetchService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                instanceId: FETCH_INSTANCE_ID,
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1_000,
            },
            source,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            transactionManager,
        );

        await service.execute();
        await expect(db.countRows("block_jobs", "status = 'failed'")).resolves.toBe(1);
        await expect(db.countRows("blocks")).resolves.toBe(0);

        await db.pool.query(
            `UPDATE block_jobs
             SET next_retry_at = NOW() - INTERVAL '1 second'
             WHERE chain_id = $1
               AND block_number = $2`,
            [CHAIN_ID, targetBlock]
        );

        await service.execute();

        const result = await db.pool.query<{
            status: string;
            attempts: number;
            next_retry_at: Date | null;
            error: string | null;
        }>(
            `SELECT status, attempts, next_retry_at, error
             FROM block_jobs
             WHERE chain_id = $1
               AND block_number = $2`,
            [CHAIN_ID, targetBlock]
        );

        expect(result.rows[0]?.status).toBe("fetched");
        expect(result.rows[0]?.attempts).toBe(2);
        expect(result.rows[0]?.next_retry_at).toBeNull();
        expect(result.rows[0]?.error).toBeNull();
        await expect(db.countRows("blocks")).resolves.toBe(1);
        await expect(db.countRows("transactions")).resolves.toBe(1);
        await expect(db.countRows("events")).resolves.toBe(1);
    });

    test("fetch worker replaces orphan block events during retry", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const targetBlock = 205;
        const payload = buildFetchedBlock(targetBlock, hashFromNumber(204));

        await db.pool.query(
            `INSERT INTO block_jobs
             (chain_id, block_number, status, attempts, next_retry_at, claimed_by, claimed_at, error)
             VALUES ($1, $2, 'failed', 9, NOW() - INTERVAL '1 second', NULL, NULL, $3)`,
            [CHAIN_ID, targetBlock, "duplicate key value violates unique constraint \"events_pkey\""]
        );
        await eventsRepository.insertMany(payload.logs);

        await expect(db.countRows("blocks", "block_number = 205")).resolves.toBe(0);
        await expect(db.countRows("transactions", "block_number = 205")).resolves.toBe(0);
        await expect(db.countRows("events", "block_number = 205")).resolves.toBe(1);

        const source: BlockSource = {
            async getLatestBlockNumber(): Promise<number> {
                return targetBlock;
            },
            async getLatestBlock() {
                return payload.block;
            },
            async getBlock() {
                return payload.block;
            },
            async getBlockData(): Promise<FetchedBlock> {
                return payload;
            },
        };

        const service = new FetchService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                instanceId: FETCH_INSTANCE_ID,
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 10,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1_000,
            },
            source,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            transactionManager,
        );

        await service.execute();

        const result = await db.pool.query<{ status: string; attempts: number; error: string | null }>(
            `SELECT status, attempts, error
             FROM block_jobs
             WHERE chain_id = $1
               AND block_number = $2`,
            [CHAIN_ID, targetBlock]
        );

        expect(result.rows[0]?.status).toBe("fetched");
        expect(result.rows[0]?.attempts).toBe(10);
        expect(result.rows[0]?.error).toBeNull();
        await expect(db.countRows("blocks", "block_number = 205")).resolves.toBe(1);
        await expect(db.countRows("transactions", "block_number = 205")).resolves.toBe(1);
        await expect(db.countRows("events", "block_number = 205")).resolves.toBe(1);
    });

    test("fetch worker takes over stale fetching claims", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const targetBlock = 210;
        const payload = buildFetchedBlock(targetBlock, hashFromNumber(209));

        await db.pool.query(
            `INSERT INTO block_jobs
             (chain_id, block_number, status, attempts, next_retry_at, claimed_by, claimed_at, error)
             VALUES ($1, $2, 'fetching', 1, NULL, 'stale-worker', NOW() - INTERVAL '2 hours', NULL)`,
            [CHAIN_ID, targetBlock]
        );

        const source: BlockSource = {
            async getLatestBlockNumber(): Promise<number> {
                return targetBlock;
            },
            async getLatestBlock() {
                return payload.block;
            },
            async getBlock() {
                return payload.block;
            },
            async getBlockData(): Promise<FetchedBlock> {
                return payload;
            },
        };

        const service = new FetchService(
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 1,
                instanceId: "fresh-instance",
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 1_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 1_000,
            },
            source,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            transactionManager,
        );

        await service.execute();

        const result = await db.pool.query<{
            status: string;
            attempts: number;
            claimed_by: string | null;
            claimed_at: Date | null;
        }>(
            `SELECT status, attempts, claimed_by, claimed_at
             FROM block_jobs
             WHERE chain_id = $1
               AND block_number = $2`,
            [CHAIN_ID, targetBlock]
        );

        expect(result.rows[0]?.status).toBe("fetched");
        expect(result.rows[0]?.attempts).toBe(2);
        expect(result.rows[0]?.claimed_by).toBeNull();
        expect(result.rows[0]?.claimed_at).toBeNull();
        await expect(db.countRows("blocks")).resolves.toBe(1);
        await expect(db.countRows("transactions")).resolves.toBe(1);
        await expect(db.countRows("events")).resolves.toBe(1);
    });
});
