import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";

import type { DbExecutor } from "../../../src/interfaces/db.js";
import type { PipelineEvent, PipelineTransaction } from "../../../src/interfaces/pipeline.js";
import type { StreamType } from "../../../src/types/pipeline.js";
import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlocksRepository } from "../../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../../src/repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/worker-cursors-repository.js";
import { ReactionService } from "../../../src/services/reaction-service.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

describe("integration: transactional reactions", () => {
    let context: IsolatedDbContext;
    beforeAll(async () => {
        context = await createIsolatedDbContext(getRequiredDatabaseUrl());
        await context.pool.query(
            "CREATE TABLE reaction_totals (item_index integer PRIMARY KEY, total integer NOT NULL)",
        );
    });
    beforeEach(async () => {
        await context.truncatePipelineTables();
        await context.pool.query("TRUNCATE reaction_totals");
    });
    afterAll(async () => { await context.close(); });

    const fixture = async (streamType: StreamType) => {
        const pool = context.pool;
        const transactionManager = new PostgresTransactionManager(pool);
        const chainCursorRepository = new PostgresChainCursorRepository(pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(pool);
        const eventsRepository = new PostgresEventsRepository(pool);
        const transactionsRepository = new PostgresTransactionsRepository(pool);
        const block = buildFetchedBlock(500, hashFromNumber(499), 3);
        await chainCursorRepository.insert({ chainId: CHAIN_ID, lastCommittedBlock: 500,
            lastEnqueuedBlock: 500, lastCommittedHash: block.block.hash, reorgVersion: 0 });
        await eventsRepository.insertMany(block.logs);
        await transactionsRepository.insertMany(block.transactions);
        await workerCursorsRepository.insert(
            "aggregate",
            CHAIN_ID,
            streamType,
            { lastBlockNumber: 499, lastTransactionIndex: -1, lastLogIndex: -1 },
            0,
        );
        const handled: number[] = [];
        let action: (item: PipelineEvent | PipelineTransaction, db: DbExecutor) => Promise<void> =
            async () => undefined;
        const handler = async (item: PipelineEvent | PipelineTransaction, db: DbExecutor, name: string) => {
            expect(name).toBe("aggregate");
            handled.push(item.index);
            await db.query("INSERT INTO reaction_totals (item_index, total) VALUES ($1, 1) "
                + "ON CONFLICT (item_index) DO UPDATE SET total = reaction_totals.total + 1", [item.index]);
            await action(item, db);
        };
        const common = {
            config: { chainId: CHAIN_ID, workerName: "aggregate", delayBetweenTicksMs: 1,
                batchSize: 3, confirmations: 0 },
            filter: () => true, handler, transactionManager, chainCursorRepository, workerCursorsRepository,
            blocksRepository: new PostgresBlocksRepository(pool),
        };
        const createService = () => streamType === "event"
            ? new ReactionService({ ...common, streamType, eventsRepository })
            : new ReactionService({ ...common, streamType, transactionsRepository });
        const totals = async () => (await pool.query<{ item_index: number; total: number }>(
            "SELECT item_index, total FROM reaction_totals ORDER BY item_index",
        )).rows;
        return { createService, totals, handled, workerCursorsRepository, chainCursorRepository,
            transactionManager, eventsRepository, transactionsRepository, block,
            cursor: () => workerCursorsRepository.get("aggregate", CHAIN_ID, streamType),
            setAction: (next: typeof action) => { action = next; },
        };
    };

    for (const streamType of ["event", "transaction"] as const) {
        test(`${streamType} commits business writes and progress together and resumes after restart`, async () => {
            const f = await fixture(streamType);
            await f.createService().execute();
            expect(await f.totals()).toEqual([0, 1, 2].map((item_index) => ({ item_index, total: 1 })));
            expect((await f.cursor())?.position.lastTransactionIndex).toBe(2);
            await f.createService().execute();
            expect(f.handled).toEqual([0, 1, 2]);
            expect(await f.totals()).toEqual([0, 1, 2].map((item_index) => ({ item_index, total: 1 })));
        });

        test.each(["handler", "cursor"] as const)(
            `${streamType} rolls back a business write on %s error and persists one effect after retry`,
            async (failure) => {
                const f = await fixture(streamType);
                if (failure === "handler") {
                    f.setAction(async (item) => {
                        if (item.index === 1) { throw new Error("handler failed after SQL"); }
                    });
                } else {
                    const advance = f.workerCursorsRepository.advanceIfVersion.bind(f.workerCursorsRepository);
                    vi.spyOn(f.workerCursorsRepository, "advanceIfVersion").mockImplementation(async (...args) => {
                        if (args[3].lastTransactionIndex === 1) {
                            const executor = args[5];
                            if (executor === undefined) { throw new Error("missing transaction executor"); }
                            await executor.query("SELECT 1 / 0");
                        }
                        return advance(...args);
                    });
                }
                await expect(f.createService().execute()).rejects.toThrow();
                expect(await f.totals()).toEqual([{ item_index: 0, total: 1 }]);
                expect((await f.cursor())?.position.lastTransactionIndex).toBe(0);
                f.setAction(async () => undefined);
                vi.restoreAllMocks();
                await f.createService().execute();
                expect(await f.totals()).toEqual([0, 1, 2].map((item_index) => ({ item_index, total: 1 })));
                expect(f.handled).toEqual([0, 1, 1, 2]);
                expect((await f.cursor())?.position.lastTransactionIndex).toBe(2);
                await f.createService().execute();
                expect(f.handled).toEqual([0, 1, 1, 2]);
            },
        );

        test(`${streamType} rolls back on reorg and keeps already committed aggregates`, async () => {
            const f = await fixture(streamType);
            let reorg = true;
            f.setAction(async (item) => {
                if (item.index !== 1 || !reorg) { return; }
                reorg = false;
                await f.transactionManager.run(async (db) => {
                    const version = await f.chainCursorRepository.setPositionsAndIncrementReorgVersion(
                        CHAIN_ID, 500, f.block.block.hash, 500, db,
                    );
                    await f.workerCursorsRepository.rewindForReorg(CHAIN_ID, 500, version, db);
                    const replacement = hashFromNumber(50_000);
                    if (streamType === "event") {
                        await f.eventsRepository.deleteBlockNumberRange(CHAIN_ID, 500, 500, db);
                        await f.eventsRepository.insertMany(f.block.logs.map((event) => ({
                            ...event, blockHash: replacement,
                        })), db);
                    } else {
                        await f.transactionsRepository.deleteBlockNumberRange(CHAIN_ID, 500, 500, db);
                        await f.transactionsRepository.insertMany(f.block.transactions.map((transaction) => ({
                            ...transaction, blockHash: replacement,
                        })), db);
                    }
                });
            });
            const service = f.createService();
            await service.execute();
            expect(f.handled).toEqual([0, 1]);
            expect(await f.totals()).toEqual([{ item_index: 0, total: 1 }]);
            expect(await f.cursor()).toMatchObject({ reorgVersion: 1,
                position: { lastBlockNumber: 500, lastTransactionIndex: -1, lastLogIndex: -1 } });
            f.setAction(async (item) => { expect(item.blockHash).toBe(hashFromNumber(50_000)); });
            await service.execute();
            expect(f.handled).toEqual([0, 1, 0, 1, 2]);
            expect(await f.totals()).toEqual([
                { item_index: 0, total: 2 }, { item_index: 1, total: 1 }, { item_index: 2, total: 1 },
            ]);
            expect(await f.cursor()).toMatchObject({ reorgVersion: 1, position: { lastTransactionIndex: 2 } });
        });
    }
});
