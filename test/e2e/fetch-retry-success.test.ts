import type { BlockSource } from "../../src/interfaces/block-source.js";
import type { FetchedBlock } from "../../src/interfaces/chain.js";
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
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../integration/helpers/fixtures.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
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
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        const block10 = buildFetchedBlock(10, committedHash, 1);

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const source = createFlakyBlockSource(10, block10, 1);

        const headWorker = new HeadWorker(
            { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
            source,
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
            new PostgresLeaderLock(db.pool, 31_100_001n),
        );
        const fetchWorker = new FetchWorker(
            "fetch-worker-e2e-retry-success",
            {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                fetchBatchSize: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 1,
                retryMaxDelayMs: 1,
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
            new PostgresLeaderLock(db.pool, 31_100_002n),
        );

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
            await expect(db.countRows("canonical_blocks", "block_number = 10")).resolves.toBe(1);
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
