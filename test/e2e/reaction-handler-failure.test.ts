import type { EventReactionHandler } from "../../src/interfaces/reaction.js";
import { PostgresCanonicalEventsRepository } from "../../src/repositories/postgres/canonical-events-repository.js";
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
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);
        const workerCursorsRepository = new PostgresWorkerCursorsRepository(db.pool);

        const block = buildFetchedBlock(100, hashFromNumber(99), 3);
        await canonicalEventsRepository.insertMany(CHAIN_ID, block.block.number, block.block.hash, block.logs);
        await workerCursorsRepository.insert("reaction-event-failure", CHAIN_ID, "event", 0n);

        const handled: bigint[] = [];
        let failures = 0;

        const handler: EventReactionHandler = {
            async handle(event): Promise<void> {
                if (event.seq === 2n && failures === 0) {
                    failures += 1;
                    throw new Error("handler temporary failure");
                }

                handled.push(event.seq);
            },
        };

        const worker = EventReactionWorker.create({
            config: {
                chainId: CHAIN_ID,
                delayBetweenTicksMs: 5,
                workerName: "reaction-event-failure",
                batchSize: 2,
            },
            handler,
            overrides: {
                canonicalEventsRepository,
                workerCursorsRepository,
                leaderLock: createLeaderLock(),
            },
        });

        try {
            await worker.start();

            await waitFor(async () => failures === 1);

            await waitFor(async () => {
                const cursor = await workerCursorsRepository.get("reaction-event-failure", CHAIN_ID, "event");
                return cursor?.lastSeq === 3n;
            });

            expect(failures).toBe(1);
            expect(handled).toEqual([1n, 2n, 3n]);
        } finally {
            await stopWorkers([worker]);
        }
    }, 15_000);
});
