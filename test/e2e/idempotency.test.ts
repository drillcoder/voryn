import type { EventReactionHandler, TransactionReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../src/repositories/postgres/worker-cursors-repository.js";
import { EventReactionWorker } from "../../src/workers/event-reaction-worker.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { TransactionReactionWorker } from "../../src/workers/transaction-reaction-worker.js";
import {
    buildFetchedBlock,
    CHAIN_ID,
    createLeaderLock,
    createMapBlockSource,
    hashFromNumber,
} from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { sleep, stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e idempotency", () => {
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

    test("restarting workers does not duplicate committed or reaction data", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
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
        const source = createMapBlockSource(11, [block10, block11]);

        const firstEventHandled: string[] = [];
        const firstTxHandled: string[] = [];

        const firstEventHandler: EventReactionHandler = async (event): Promise<"processed"> => {
            firstEventHandled.push(`${String(event.blockNumber)}:${String(event.index)}`);

            return "processed";
        };
        const firstTxHandler: TransactionReactionHandler = async (transaction): Promise<"processed"> => {
            firstTxHandled.push(`${String(transaction.blockNumber)}:${String(transaction.index)}`);

            return "processed";
        };

        const firstRunWorkers = await createWorkerSet(
            source,
            transactionManager,
            chainCursorRepository,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            workerCursorsRepository,
            firstEventHandler,
            firstTxHandler,
            "idem",
        );

        try {
            await startPipeline(firstRunWorkers);

            await waitFor(async () => {
                const cursor = await chainCursorRepository.get(CHAIN_ID);
                return cursor?.lastCommittedBlock === 11;
            });
            await waitFor(async () => firstEventHandled.length === 3 && firstTxHandled.length === 3);

            const baseline = await snapshotCounts(db);
            expect(firstEventHandled).toEqual(["10:0", "10:1", "11:0"]);
            expect(firstTxHandled).toEqual(["10:0", "10:1", "11:0"]);

            await stopWorkers(firstRunWorkers.all);

            const secondEventHandled: string[] = [];
            const secondTxHandled: string[] = [];
            const secondEventHandler: EventReactionHandler = async (event): Promise<"processed"> => {
                secondEventHandled.push(`${String(event.blockNumber)}:${String(event.index)}`);

                return "processed";
            };
            const secondTxHandler: TransactionReactionHandler = async (transaction): Promise<"processed"> => {
                secondTxHandled.push(`${String(transaction.blockNumber)}:${String(transaction.index)}`);

                return "processed";
            };

            const secondRunWorkers = await createWorkerSet(
                source,
                transactionManager,
                chainCursorRepository,
                blockJobsRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                workerCursorsRepository,
                secondEventHandler,
                secondTxHandler,
                "idem",
            );

            try {
                await startPipeline(secondRunWorkers);
                await sleep(200);
            } finally {
                await stopWorkers(secondRunWorkers.all);
            }

            const afterRestart = await snapshotCounts(db);
            expect(afterRestart).toEqual(baseline);
            expect(secondEventHandled).toEqual([]);
            expect(secondTxHandled).toEqual([]);
        } finally {
            await stopWorkers(firstRunWorkers.all);
        }
    });
});

async function createWorkerSet(
    source: ReturnType<typeof createMapBlockSource>,
    transactionManager: PostgresTransactionManager,
    chainCursorRepository: PostgresChainCursorRepository,
    blockJobsRepository: PostgresBlockJobsRepository,
    blocksRepository: PostgresBlocksRepository,
    transactionsRepository: PostgresTransactionsRepository,
    eventsRepository: PostgresEventsRepository,
    workerCursorsRepository: PostgresWorkerCursorsRepository,
    eventHandler: EventReactionHandler,
    transactionHandler: TransactionReactionHandler,
    workerSuffix: string,
): Promise<{
    head: HeadWorker;
    fetch: FetchWorker;
    sequencer: SequencerWorker;
    event: EventReactionWorker;
    transaction: TransactionReactionWorker;
    all: readonly [HeadWorker, FetchWorker, SequencerWorker, EventReactionWorker, TransactionReactionWorker];
}> {
    const head = await HeadWorker.create({
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
            leaderLock: createLeaderLock(),
        },
    });
    const fetch = await FetchWorker.create({
        logLevel: "error",
        config: {
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            fetchBatchSize: 2,
            fetchConcurrency: 1,
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
    const sequencer = await SequencerWorker.create({
        logLevel: "error",
        config: { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 2 },
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
    const event = await EventReactionWorker.create({
        logLevel: "error",
        config: {
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            workerName: `reaction-event-${workerSuffix}`,
            batchSize: 2,
            skipFlushInterval: 2,
        },
        handler: eventHandler,
        overrides: {
            chainCursorRepository,
            eventsRepository,
            workerCursorsRepository,
            leaderLock: createLeaderLock(),
        },
    });
    const transaction = await TransactionReactionWorker.create({
        logLevel: "error",
        config: {
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            workerName: `reaction-transaction-${workerSuffix}`,
            batchSize: 2,
            skipFlushInterval: 2,
        },
        handler: transactionHandler,
        overrides: {
            chainCursorRepository,
            transactionsRepository,
            workerCursorsRepository,
            leaderLock: createLeaderLock(),
        },
    });

    return {
        head,
        fetch,
        sequencer,
        event,
        transaction,
        all: [head, fetch, sequencer, event, transaction],
    };
}

async function startPipeline(workers: {
    head: HeadWorker;
    fetch: FetchWorker;
    sequencer: SequencerWorker;
    event: EventReactionWorker;
    transaction: TransactionReactionWorker;
}): Promise<void> {
    await workers.event.start();
    await workers.transaction.start();
    await workers.head.start();
    await workers.fetch.start();
    await workers.sequencer.start();
}

async function snapshotCounts(db: IsolatedDbContext): Promise<Record<string, number>> {
    return {
        blockJobs: await db.countRows("block_jobs", "block_number BETWEEN 10 AND 11"),
        blocks: await db.countRows("blocks", "block_number BETWEEN 10 AND 11"),
        transactions: await db.countRows("transactions", "block_number BETWEEN 10 AND 11"),
        events: await db.countRows("events", "block_number BETWEEN 10 AND 11"),
    };
}
