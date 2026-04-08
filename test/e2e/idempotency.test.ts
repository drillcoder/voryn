import type { EventReactionHandler, TransactionReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresTransactionManager } from "../../src/postgres/index.js";
import {
    PostgresBlockJobsRepository,
    PostgresCanonicalBlocksRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
    PostgresWorkerCursorsRepository,
} from "../../src/repositories/postgres/index.js";
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
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
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
        const source = createMapBlockSource(11, [block10, block11]);

        const firstEventHandled: bigint[] = [];
        const firstTxHandled: bigint[] = [];

        const firstEventHandler: EventReactionHandler = {
            async handle(event): Promise<void> {
                firstEventHandled.push(event.seq);
            },
        };
        const firstTxHandler: TransactionReactionHandler = {
            async handle(transaction): Promise<void> {
                firstTxHandled.push(transaction.seq);
            },
        };

        const firstRunWorkers = createWorkerSet(
            source,
            transactionManager,
            chainCursorRepository,
            blockJobsRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
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
            expect(firstEventHandled).toEqual([1n, 2n, 3n]);
            expect(firstTxHandled).toEqual([1n, 2n, 3n]);

            await stopWorkers(firstRunWorkers.all);

            const secondEventHandled: bigint[] = [];
            const secondTxHandled: bigint[] = [];
            const secondEventHandler: EventReactionHandler = {
                async handle(event): Promise<void> {
                    secondEventHandled.push(event.seq);
                },
            };
            const secondTxHandler: TransactionReactionHandler = {
                async handle(transaction): Promise<void> {
                    secondTxHandled.push(transaction.seq);
                },
            };

            const secondRunWorkers = createWorkerSet(
                source,
                transactionManager,
                chainCursorRepository,
                blockJobsRepository,
                rawBlocksRepository,
                canonicalBlocksRepository,
                canonicalTransactionsRepository,
                canonicalEventsRepository,
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

function createWorkerSet(
    source: ReturnType<typeof createMapBlockSource>,
    transactionManager: PostgresTransactionManager,
    chainCursorRepository: PostgresChainCursorRepository,
    blockJobsRepository: PostgresBlockJobsRepository,
    rawBlocksRepository: PostgresRawBlocksRepository,
    canonicalBlocksRepository: PostgresCanonicalBlocksRepository,
    canonicalTransactionsRepository: PostgresCanonicalTransactionsRepository,
    canonicalEventsRepository: PostgresCanonicalEventsRepository,
    workerCursorsRepository: PostgresWorkerCursorsRepository,
    eventHandler: EventReactionHandler,
    txHandler: TransactionReactionHandler,
    workerSuffix: string,
): {
    head: HeadWorker;
    fetch: FetchWorker;
    sequencer: SequencerWorker;
    event: EventReactionWorker;
    tx: TransactionReactionWorker;
    all: readonly [HeadWorker, FetchWorker, SequencerWorker, EventReactionWorker, TransactionReactionWorker];
} {
    const head = new HeadWorker(
        { chainId: CHAIN_ID, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
        source,
        chainCursorRepository,
        blockJobsRepository,
        rawBlocksRepository,
        transactionManager,
        createLeaderLock(),
    );
    const fetch = new FetchWorker(
        `fetch-worker-${workerSuffix}`,
        {
            chainId: CHAIN_ID,
            delayBetweenTicksMs: 5,
            fetchBatchSize: 2,
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
    const sequencer = new SequencerWorker(
        { chainId: CHAIN_ID, delayBetweenTicksMs: 5, maxBlocksPerTick: 2 },
        chainCursorRepository,
        rawBlocksRepository,
        canonicalBlocksRepository,
        canonicalTransactionsRepository,
        canonicalEventsRepository,
        blockJobsRepository,
        transactionManager,
        createLeaderLock(),
    );
    const event = new EventReactionWorker(
        { chainId: CHAIN_ID, delayBetweenTicksMs: 5, workerName: `reaction-event-${workerSuffix}`, batchSize: 2 },
        eventHandler,
        canonicalEventsRepository,
        workerCursorsRepository,
        createLeaderLock(),
    );
    const tx = new TransactionReactionWorker(
        { chainId: CHAIN_ID, delayBetweenTicksMs: 5, workerName: `reaction-tx-${workerSuffix}`, batchSize: 2 },
        txHandler,
        canonicalTransactionsRepository,
        workerCursorsRepository,
        createLeaderLock(),
    );

    return {
        head,
        fetch,
        sequencer,
        event,
        tx,
        all: [head, fetch, sequencer, event, tx],
    };
}

async function startPipeline(workers: {
    head: HeadWorker;
    fetch: FetchWorker;
    sequencer: SequencerWorker;
    event: EventReactionWorker;
    tx: TransactionReactionWorker;
}): Promise<void> {
    await workers.event.start();
    await workers.tx.start();
    await workers.head.start();
    await workers.fetch.start();
    await workers.sequencer.start();
}

async function snapshotCounts(db: IsolatedDbContext): Promise<Record<string, number>> {
    return {
        blockJobs: await db.countRows("block_jobs", "block_number BETWEEN 10 AND 11"),
        rawBlocks: await db.countRows("raw_blocks", "block_number BETWEEN 10 AND 11"),
        canonicalBlocks: await db.countRows("canonical_blocks", "block_number BETWEEN 10 AND 11"),
        canonicalTx: await db.countRows("canonical_transactions", "block_number BETWEEN 10 AND 11"),
        canonicalEvents: await db.countRows("canonical_events", "block_number BETWEEN 10 AND 11"),
    };
}
