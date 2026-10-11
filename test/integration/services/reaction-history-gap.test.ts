import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";

import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import type { StreamType } from "../../../src/types/pipeline.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/worker-cursors-repository.js";
import { HeadService } from "../../../src/services/head-service.js";
import { ReactionService } from "../../../src/services/reaction-service.js";
import { RetentionService } from "../../../src/services/retention-service.js";
import { buildFetchedBlock, CHAIN_ID, createMapBlockSource, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
};

describe("integration services: reaction history gaps", () => {
    let db: IsolatedDbContext;
    beforeAll(async () => { db = await createIsolatedDbContext(DATABASE_URL); });
    beforeEach(async () => { await db.truncatePipelineTables(); });
    afterAll(async () => { await db.close(); });

    const fixture = async (streamType: StreamType) => {
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const transactionManager = new PostgresTransactionManager(db.pool);
        const workerName = `gap-${streamType}`;
        await chainCursorRepository.insert({ chainId: CHAIN_ID, lastCommittedBlock: 90,
            lastEnqueuedBlock: 90, lastCommittedHash: hashFromNumber(90), reorgVersion: 0 });
        await workerCursorsRepository.insert(
            workerName,
            CHAIN_ID,
            streamType,
            { lastBlockNumber: 90, lastTransactionIndex: 0, lastLogIndex: -1 },
            0,
        );
        // A different network must neither change the boundary nor have its cursor moved.
        await blocksRepository.insert({ chainId: 2, blockNumber: 1, blockHash: hashFromNumber(1),
            parentHash: hashFromNumber(0), blockTimestamp: 1, fetchedAt: new Date() });
        await workerCursorsRepository.insert(
            workerName,
            2,
            streamType,
            { lastBlockNumber: 0, lastTransactionIndex: -1, lastLogIndex: -1 },
            0,
        );
        const warn = vi.fn();
        const handled: number[] = [];
        let fail = true;
        const handler = async (item: { blockNumber: number }): Promise<"processed"> => {
            handled.push(item.blockNumber);
            const cursor = await workerCursorsRepository.get(workerName, CHAIN_ID, streamType);
            expect(cursor?.position).toEqual({ lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 });
            if (fail) { throw new Error("handler failed"); }
            return "processed";
        };
        const common = {
            config: { chainId: CHAIN_ID, workerName, delayBetweenTicksMs: 1, batchSize: 1,
                skipFlushInterval: 1, confirmations: 0 },
            chainCursorRepository, blocksRepository, workerCursorsRepository, transactionManager,
            logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
        };
        const createService = () => streamType === "event"
            ? new ReactionService({ ...common, streamType, handler, eventsRepository })
            : new ReactionService({ ...common, streamType, handler, transactionsRepository });
        const insertBlock = async (block: FetchedBlock) => {
            await blocksRepository.insert({ chainId: CHAIN_ID, blockNumber: block.block.number,
                blockHash: block.block.hash, parentHash: block.block.parentHash,
                blockTimestamp: block.block.timestamp, fetchedAt: new Date() });
            await eventsRepository.insertMany(block.logs);
            await transactionsRepository.insertMany(block.transactions);
        };
        return {
            ...common, blockJobsRepository, eventsRepository, transactionsRepository,
            createService, insertBlock, warn, handled, workerName, allowHandler: () => { fail = false; },
        };
    };

    for (const stream of ["event", "transaction"] as const) {
        test.each(["head rebase", "retention"])(
            `${stream} survives a gap from %s and a handler restart`, async (cause) => {
            const f = await fixture(stream);
            const block90 = buildFetchedBlock(90, hashFromNumber(89));
            const block100 = buildFetchedBlock(100, hashFromNumber(99));
            const block101 = buildFetchedBlock(101, hashFromNumber(100));
            await f.insertBlock(block90);
            if (cause === "head rebase") {
                const head = new HeadService(
                    { chainId: CHAIN_ID, delayBetweenTicksMs: 1, depthBlocks: 2 },
                    createMapBlockSource(101, [block100, block101]),
                    f.chainCursorRepository,
                    f.blockJobsRepository,
                    f.blocksRepository,
                    f.transactionsRepository,
                    f.eventsRepository,
                    f.transactionManager,
                );
                await head.execute();
                await f.createService().execute();
                expect(f.warn).not.toHaveBeenCalled();
                expect(f.handled).toEqual([]);
            }
            await f.insertBlock(block100);
            await f.insertBlock(block101);
            await f.chainCursorRepository.setPositions(CHAIN_ID, 101, block101.block.hash, 101);
            if (cause === "retention") {
                await new RetentionService(
                    { chainId: CHAIN_ID, delayBetweenTicksMs: 1, retentionDepthBlocks: 2 },
                    f.chainCursorRepository,
                    f.blockJobsRepository,
                    f.blocksRepository,
                    f.transactionsRepository,
                    f.eventsRepository,
                    f.transactionManager,
                ).execute();
            }
            await expect(f.blocksRepository.getOldestBlockNumber(CHAIN_ID)).resolves.toBe(100);
            await expect(f.createService().execute()).rejects.toThrow("handler failed");
            await expect(f.workerCursorsRepository.get(f.workerName, CHAIN_ID, stream)).resolves.toMatchObject({
                position: { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 }, reorgVersion: 0,
            });
            expect(f.warn).toHaveBeenCalledExactlyOnceWith("reaction_history_gap", {
                chainId: CHAIN_ID, workerName: f.workerName, streamType: stream,
                previousPosition: { lastBlockNumber: 90, lastTransactionIndex: 0, lastLogIndex: -1 },
                fromBlock: 90, toBlock: 99, firstAvailableBlock: 100,
            });
            f.allowHandler();
            await f.createService().execute();
            expect(f.handled).toEqual([100, 100]);
            expect(f.warn).toHaveBeenCalledTimes(1);
            await expect(f.workerCursorsRepository.get(f.workerName, CHAIN_ID, stream)).resolves.toMatchObject({
                position: { lastBlockNumber: 100, lastTransactionIndex: 0, lastLogIndex: stream === "event" ? 0 : -1 },
            });
            await expect(f.workerCursorsRepository.get(f.workerName, 2, stream)).resolves.toMatchObject({
                position: { lastBlockNumber: 0, lastTransactionIndex: -1, lastLogIndex: -1 }, reorgVersion: 0,
            });
        });

        test(`${stream} gap update blocks concurrent retention until its cursor is saved`, async () => {
            const f = await fixture(stream);
            await f.insertBlock(buildFetchedBlock(100, hashFromNumber(99)));
            await f.insertBlock(buildFetchedBlock(101, hashFromNumber(100)));
            await f.chainCursorRepository.setPositions(CHAIN_ID, 101, hashFromNumber(101), 101);
            f.config.confirmations = 10;
            const held = deferred();
            const release = deferred();
            const attempted = deferred();
            const advance = f.workerCursorsRepository.advanceIfVersion.bind(f.workerCursorsRepository);
            vi.spyOn(f.workerCursorsRepository, "advanceIfVersion").mockImplementationOnce(async (...args) => {
                held.resolve();
                await release.promise;
                return advance(...args);
            });
            const retentionCursorRepository = new PostgresChainCursorRepository(db.pool);
            const lock = retentionCursorRepository.getForUpdate.bind(retentionCursorRepository);
            let retentionAcquired = false;
            let retentionPid: number | undefined;
            vi.spyOn(retentionCursorRepository, "getForUpdate").mockImplementation(async (...args) => {
                const backend = await args[1].query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
                retentionPid = backend.rows[0]?.pid;
                attempted.resolve();
                const cursor = await lock(...args);
                retentionAcquired = true;
                return cursor;
            });
            const reaction = f.createService().execute();
            let retention: Promise<void> | undefined;
            try {
                await held.promise;
                retention = new RetentionService(
                    { chainId: CHAIN_ID, delayBetweenTicksMs: 1, retentionDepthBlocks: 1 },
                    retentionCursorRepository,
                    f.blockJobsRepository,
                    f.blocksRepository,
                    f.transactionsRepository,
                    f.eventsRepository,
                    f.transactionManager,
                ).execute();
                await attempted.promise;
                // Observe PostgreSQL's actual wait rather than assuming a scheduling delay.
                await vi.waitFor(async () => {
                    const waiting = await db.pool.query<{ count: string }>(
                        `SELECT count(*)::text AS count FROM pg_stat_activity
                         WHERE pid = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
                        [retentionPid]
                    );
                    expect(Number(waiting.rows[0]?.count)).toBeGreaterThan(0);
                });
                expect(retentionAcquired).toBe(false);
                await expect(f.blocksRepository.getOldestBlockNumber(CHAIN_ID)).resolves.toBe(100);
            } finally {
                release.resolve();
                await Promise.all([reaction, retention]);
            }
            expect(retentionAcquired).toBe(true);
            await expect(f.workerCursorsRepository.get(f.workerName, CHAIN_ID, stream)).resolves.toMatchObject({
                position: { lastBlockNumber: 100, lastTransactionIndex: -1, lastLogIndex: -1 },
            });
            await expect(f.blocksRepository.getOldestBlockNumber(CHAIN_ID)).resolves.toBe(101);
            await f.createService().execute();
            expect(f.warn).toHaveBeenCalledTimes(2);
            expect(f.handled).toEqual([]);
        });

        test(`${stream} rejects a gap detected before a PostgreSQL reorg rollback`, async () => {
            const f = await fixture(stream);
            await f.insertBlock(buildFetchedBlock(100, hashFromNumber(99)));
            await f.chainCursorRepository.setPositions(CHAIN_ID, 100, hashFromNumber(100), 100);
            const getOldest = f.blocksRepository.getOldestBlockNumber.bind(f.blocksRepository);
            vi.spyOn(f.blocksRepository, "getOldestBlockNumber").mockImplementationOnce(async (chainId) => {
                const oldest = await getOldest(chainId);
                await f.transactionManager.run(async (transaction) => {
                    await f.chainCursorRepository.getForUpdate(CHAIN_ID, transaction);
                    await f.blocksRepository.deleteBlockNumberRange(CHAIN_ID, 100, 100, transaction);
                    await f.eventsRepository.deleteBlockNumberRange(CHAIN_ID, 100, 100, transaction);
                    await f.transactionsRepository.deleteBlockNumberRange(CHAIN_ID, 100, 100, transaction);
                    const version = await f.chainCursorRepository.setPositionsAndIncrementReorgVersion(
                        CHAIN_ID, 99, hashFromNumber(99), 99, transaction);
                    await f.workerCursorsRepository.rewindForReorg(CHAIN_ID, 100, version, transaction);
                });
                return oldest;
            });
            await f.createService().execute();
            expect(f.warn).not.toHaveBeenCalled();
            expect(f.handled).toEqual([]);
            await expect(f.workerCursorsRepository.get(f.workerName, CHAIN_ID, stream)).resolves.toMatchObject({
                position: { lastBlockNumber: 90, lastTransactionIndex: 0, lastLogIndex: -1 }, reorgVersion: 1,
            });
        });
    }
});
