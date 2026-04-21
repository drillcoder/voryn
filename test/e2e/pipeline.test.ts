import { PostgresLeaderLock } from "../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import type { EventReactionHandler, TransactionReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../src/repositories/postgres/raw-blocks-repository.js";
import { PostgresWorkerCursorsRepository } from "../../src/repositories/postgres/worker-cursors-repository.js";
import { EventReactionWorker } from "../../src/workers/event-reaction-worker.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { RetentionWorker } from "../../src/workers/retention-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { TransactionReactionWorker } from "../../src/workers/transaction-reaction-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();
const REACTION_WORKER_EVENT = "reaction-event-e2e";
const REACTION_WORKER_TX = "reaction-tx-e2e";
const FETCH_WORKER_ID = "fetch-worker-e2e";

describe("e2e pipeline", () => {
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

    test("runs full ingestion and reaction flow via worker lifecycle", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);

        const committedHash = hashFromNumber(9);
        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: committedHash,
        });

        const block10 = buildFetchedBlock(10, committedHash, 2);
        const block11 = buildFetchedBlock(11, block10.block.hash, 1);
        const block12 = buildFetchedBlock(12, block11.block.hash, 2);
        const block13 = buildFetchedBlock(13, block12.block.hash, 1);
        const source = createMapBlockSource(13, [block10, block11, block12, block13]);
        const expectedItemCount = 6;

        const handledEventSeqs: bigint[] = [];
        const handledTxSeqs: bigint[] = [];

        const eventHandler: EventReactionHandler = {
            async handle(event): Promise<void> {
                handledEventSeqs.push(event.seq);
            },
        };
        const txHandler: TransactionReactionHandler = {
            async handle(transaction): Promise<void> {
                handledTxSeqs.push(transaction.seq);
            },
        };

        const eventWorker = EventReactionWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: REACTION_WORKER_EVENT,
                batchSize: 2,
            },
            handler: eventHandler,
            overrides: {
                canonicalEventsRepository,
                workerCursorsRepository,
                leaderLock: new PostgresLeaderLock(db.pool, 30_000_001n),
            },
        });

        const txWorker = TransactionReactionWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: REACTION_WORKER_TX,
                batchSize: 2,
            },
            handler: txHandler,
            overrides: {
                transactionsRepository: canonicalTransactionsRepository,
                workerCursorsRepository,
                leaderLock: new PostgresLeaderLock(db.pool, 30_000_002n),
            },
        });

        const headWorker = HeadWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                confirmations: 0,
                depthBlocks: 64,
            },
            source,
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                rawBlocksRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 30_000_003n),
            },
        });

        const fetchWorker = FetchWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerId: FETCH_WORKER_ID,
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

        const sequencerWorker = SequencerWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                maxBlocksPerTick: 2,
            },
            overrides: {
                chainCursorRepository,
                rawBlocksRepository,
                canonicalBlocksRepository,
                canonicalTransactionsRepository,
                canonicalEventsRepository,
                blockJobsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 30_000_004n),
            },
        });

        const retentionWorker = RetentionWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                retentionDepthBlocks: 2,
            },
            overrides: {
                chainCursorRepository,
                blockJobsRepository,
                rawBlocksRepository,
                canonicalBlocksRepository,
                canonicalTransactionsRepository,
                canonicalEventsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 30_000_005n),
            },
        });

        try {
            await eventWorker.start();
            await txWorker.start();
            await headWorker.start();
            await fetchWorker.start();
            await sequencerWorker.start();

            await waitFor(async () => {
                const cursor = await chainCursorRepository.get(CHAIN_ID);
                if (cursor?.lastCommittedBlock !== 13) {
                    return false;
                }

                if (handledEventSeqs.length !== expectedItemCount || handledTxSeqs.length !== expectedItemCount) {
                    return false;
                }

                const committedJobs = await db.countRows("block_jobs", "status = 'committed'");
                return committedJobs === 4;
            });

            await sequencerWorker.stop();
            await fetchWorker.stop();
            await headWorker.stop();
            await eventWorker.stop();
            await txWorker.stop();

            expect(handledEventSeqs).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
            expect(handledTxSeqs).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);

            await retentionWorker.start();
            await waitFor(async () => {
                const oldRows = await db.countRows("canonical_blocks", "block_number <= 11");
                return oldRows === 0;
            });
            await retentionWorker.stop();

            await expect(db.countRows("canonical_blocks", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_transactions", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_events", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("raw_blocks", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("block_jobs", "block_number <= 11")).resolves.toBe(0);
            await expect(db.countRows("canonical_blocks", "block_number >= 12")).resolves.toBe(2);
            await expect(db.countRows("canonical_transactions", "block_number >= 12")).resolves.toBe(3);
            await expect(db.countRows("canonical_events", "block_number >= 12")).resolves.toBe(3);
        } finally {
            await Promise.all([
                eventWorker.stop(),
                txWorker.stop(),
                headWorker.stop(),
                fetchWorker.stop(),
                sequencerWorker.stop(),
                retentionWorker.stop(),
            ]);
        }
    });
});

async function waitFor(
    condition: () => Promise<boolean>,
    timeoutMs = 8_000,
    intervalMs = 25,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Condition was not met within ${String(timeoutMs)}ms`);
}
