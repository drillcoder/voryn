import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

import type { FetchedBlock } from "../../src/interfaces/chain.js";
import { PostgresLeaderLock } from "../../src/postgres/leader-lock.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../src/repositories/postgres/worker-cursors-repository.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { TransactionReactionWorker } from "../../src/workers/transaction-reaction-worker.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e reaction replay after reorg", () => {
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

    test("replacement data at an already processed position reaches the reaction again", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const commonBlock = buildFetchedBlock(9, hashFromNumber(8), 0);
        const oldBlock = buildFetchedBlock(10, commonBlock.block.hash, 1);
        const replacementHash = hashFromNumber(10_010);
        const replacementTransactionHash = hashFromNumber(10_100);
        const replacementBlock: FetchedBlock = {
            block: { ...oldBlock.block, hash: replacementHash },
            transactions: oldBlock.transactions.map((transaction) => ({
                ...transaction,
                blockHash: replacementHash,
                hash: replacementTransactionHash,
            })),
            logs: [],
        };
        const nextBlock = buildFetchedBlock(11, replacementHash, 0);
        const source = createMapBlockSource(11, [commonBlock, replacementBlock, nextBlock]);
        const handledHashes: string[] = [];

        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: 11,
            lastCommittedBlock: 10,
            lastCommittedHash: oldBlock.block.hash,
            reorgVersion: 0,
        });
        for (const block of [commonBlock, oldBlock, nextBlock]) {
            await blocksRepository.insert({
                chainId: CHAIN_ID,
                blockNumber: block.block.number,
                blockHash: block.block.hash,
                parentHash: block.block.parentHash,
                blockTimestamp: block.block.timestamp,
                fetchedAt: new Date(),
            });
        }
        await transactionsRepository.insertMany(oldBlock.transactions);
        await db.pool.query(
            `INSERT INTO block_jobs (chain_id, block_number, status)
             VALUES ($1, $2, 'fetched')`,
            [CHAIN_ID, 11]
        );
        await workerCursorsRepository.insert(
            "reorg-replay",
            CHAIN_ID,
            "transaction",
            { lastBlockNumber: 9, lastTransactionIndex: -1, lastLogIndex: -1 },
            0
        );

        const createReactionWorker = async (lockKey: bigint): Promise<TransactionReactionWorker> => (
            TransactionReactionWorker.create({
                logLevel: "error",
                chainId: CHAIN_ID,
                workerName: "reorg-replay",
                delayBetweenTicksMs: 5,
                batchSize: 10,
                skipFlushInterval: 10,
                confirmations: 0,
                handler: async (transaction) => {
                    handledHashes.push(transaction.hash);
                    return "processed";
                },
                overrides: {
                    chainCursorRepository,
                    transactionsRepository,
                    workerCursorsRepository,
                    transactionManager,
                    leaderLock: new PostgresLeaderLock(db.pool, lockKey),
                },
            })
        );
        const firstReactionWorker = await createReactionWorker(31_000_101n);
        const sequencerWorker = await SequencerWorker.create({
            logLevel: "error",
            sourceConfig: { chainId: CHAIN_ID, source },
            delayBetweenTicksMs: 5,
            maxBlocksPerTick: 1,
            overrides: {
                chainCursorRepository,
                blocksRepository,
                transactionsRepository,
                eventsRepository,
                blockJobsRepository,
                workerCursorsRepository,
                transactionManager,
                leaderLock: new PostgresLeaderLock(db.pool, 31_000_102n),
            },
        });
        let replacementReactionWorker: TransactionReactionWorker | null = null;

        try {
            await firstReactionWorker.start();
            await waitFor(() => Promise.resolve(handledHashes.length === 1));
            await firstReactionWorker.stop();

            await sequencerWorker.start();
            await waitFor(async () => (await chainCursorRepository.get(CHAIN_ID))?.reorgVersion === 1);
            await sequencerWorker.stop();

            await transactionsRepository.insertMany(replacementBlock.transactions);
            await chainCursorRepository.setPositions(CHAIN_ID, 10, replacementHash, 10);

            replacementReactionWorker = await createReactionWorker(31_000_103n);
            await replacementReactionWorker.start();
            await waitFor(() => Promise.resolve(handledHashes.length === 2));

            expect(handledHashes).toEqual([
                oldBlock.transactions[0]?.hash,
                replacementTransactionHash,
            ]);
            await expect(
                workerCursorsRepository.get("reorg-replay", CHAIN_ID, "transaction")
            ).resolves.toMatchObject({
                position: { lastBlockNumber: 10, lastTransactionIndex: 0, lastLogIndex: -1 },
                reorgVersion: 1,
            });
        } finally {
            await stopWorkers([
                firstReactionWorker,
                sequencerWorker,
                ...(replacementReactionWorker === null ? [] : [replacementReactionWorker]),
            ]);
        }
    });
});
