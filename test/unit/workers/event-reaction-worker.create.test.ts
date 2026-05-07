import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { EventReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import {
    ADDRESS,
    createNoopCanonicalEventsRepository,
    DATA,
    HASH_A,
    HASH_B,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
} from "../helpers/pipeline-test-helpers.js";

test("event reaction worker create wires service execution", async () => {
    const handled: bigint[] = [];
    const config: ReactionWorkerConfig = {
        chainId: 12,
        workerName: "event-reaction",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };
    const handler: EventReactionHandler = {
        handle: async (event) => {
            handled.push(event.seq);
        },
    };
    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => ({
            workerName: "event-reaction",
            chainId: 12,
            streamType: "event",
            lastSeq: 0n,
            updatedAt: new Date(),
        }),
        listByChain: async () => [],
        insert: async () => undefined,
        advance: async () => undefined,
    };
    const canonicalEventsRepository: CanonicalEventsRepository = {
        ...createNoopCanonicalEventsRepository(),
        readFromSeq: async () => [
            {
                seq: 1n,
                chainId: 12,
                blockNumber: 1,
                blockHash: HASH_A,
                transactionIndex: 0,
                transactionHash: HASH_B,
                index: 0,
                address: ADDRESS,
                topics: [HASH_A],
                data: DATA,
                raw: {},
            },
        ],
    };

    const worker = await EventReactionWorker.create({
        config,
        handler,
        overrides: {
            canonicalEventsRepository,
            workerCursorsRepository,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(handled).toEqual([1n]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 12,
        workerName: "event-reaction",
        batchSize: 10,
    });
});
