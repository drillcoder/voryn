import type { BlockSource } from "../../src/interfaces/block-source.js";
import type { FetchedBlock } from "../../src/interfaces/chain.js";
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
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";
import { getBlockJob } from "./helpers/db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e fetch retry success", () => {
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

    test("fetch retries once and then block is committed", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        const block10 = buildFetchedBlock(10, committedHash, 1);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const source = createFlakyBlockSource(10, block10, 1);

        const headWorker = await HeadWorker.create({
            logLevel: "error",
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_100_001n),
            },
        });
        const fetchWorker = await FetchWorker.create({
            logLevel: "error",
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 1,
                retryMaxDelayMs: 1,
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
            logLevel: "error",
            config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 1 },
            source,
            overrides: {
                chainCursorRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                blockJobsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_100_002n),
            },
        });

        try {
            await headWorker.start();
            await fetchWorker.start();
            await sequencerWorker.start();

            await waitFor(async () => {
                const cursor = await chainCursorRepository.get(CHAIN_ID);
                return cursor?.lastCommittedBlock === 10;
            });

            const job = await getBlockJob(db, 10);
            expect(job?.status).toBe("committed");
            expect(job?.attempts).toBe(2);
            expect(source.blockFetchCalls).toBe(2);
            await expect(db.countRows("blocks", "block_number = 10")).resolves.toBe(1);
        } finally {
            await stopWorkers([headWorker, fetchWorker, sequencerWorker]);
        }
    });
});

function createFlakyBlockSource(
    latestBlock: number,
    block: FetchedBlock,
    failuresBeforeSuccess: number,
): BlockSource & { blockFetchCalls: number } {
    let blockFetchCalls = 0;

    return {
        get blockFetchCalls(): number {
            return blockFetchCalls;
        },
        async getLatestBlockNumber(): Promise<number> {
            return latestBlock;
        },
        async getLatestBlock() {
            return block.block;
        },
        async getBlock(_: number, blockNumber: number) {
            if (blockNumber !== block.block.number) {
                throw new Error(`unexpected block number ${String(blockNumber)}`);
            }

            return block.block;
        },
        async getBlockData(_: number, blockNumber: number): Promise<FetchedBlock> {
            if (blockNumber !== block.block.number) {
                throw new Error(`unexpected block number ${String(blockNumber)}`);
            }

            blockFetchCalls += 1;
            if (blockFetchCalls <= failuresBeforeSuccess) {
                throw new Error("temporary RPC error");
            }

            return block;
        },
    };
}
