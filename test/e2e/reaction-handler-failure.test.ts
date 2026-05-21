import type { EventReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresWorkerCursorsRepository } from "../../src/repositories/postgres/worker-cursors-repository.js";
import { EventReactionWorker } from "../../src/workers/event-reaction-worker.js";
import { buildFetchedBlock, CHAIN_ID, createLeaderLock, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("e2e reaction handler failure", () => {
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

    test("event cursor does not skip failed event and continues on next tick", async () => {
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);

        const block = buildFetchedBlock(100, hashFromNumber(99), 3);
        await chainCursorRepository.insert({
            chainId: CHAIN_ID,
            lastEnqueuedBlock: block.block.number,
            lastCommittedBlock: block.block.number,
            lastCommittedHash: block.block.hash,
        });
        await eventsRepository.insertMany(block.logs);
        await workerCursorsRepository.insert(
            "reaction-event-failure",
            CHAIN_ID,
            "event",
            { lastBlockNumber: 99, lastTransactionIndex: -1, lastLogIndex: -1 }
        );

        const handled: number[] = [];
        let failures = 0;

        const handler: EventReactionHandler = {
            async handle(event): Promise<"processed"> {
                if (event.index === 1 && failures === 0) {
                    failures += 1;
                    throw new Error("handler temporary failure");
                }

                handled.push(event.index);

                return "processed";
            },
        };

        const worker = await EventReactionWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: "reaction-event-failure",
                batchSize: 2,
                skipFlushInterval: 2,
            },
            handler,
            overrides: {
                chainCursorRepository,
                eventsRepository,
                workerCursorsRepository,
                leaderLock: createLeaderLock(),
            },
        });

        try {
            await worker.start();

            await waitFor(async () => failures === 1);

            await waitFor(async () => {
                const cursor = await workerCursorsRepository.get("reaction-event-failure", CHAIN_ID, "event");
                return cursor?.position.lastBlockNumber === 100
                    && cursor.position.lastTransactionIndex === 2
                    && cursor.position.lastLogIndex === 2;
            });

            expect(failures).toBe(1);
            expect(handled).toEqual([0, 1, 2]);
        } finally {
            await stopWorkers([worker]);
        }
    }, 15_000);
});
