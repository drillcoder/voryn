import type { EventReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import {
    ADDRESS,
    createNoopChainCursorRepository,
    createNoopEventsRepository,
    createNoopWorkerCursorsRepository,
    DATA,
    HASH_A,
    HASH_B,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
} from "../helpers/pipeline-test-helpers.js";

test("event reaction worker create wires service execution", async () => {
    const handled: Array<[number, number, number]> = [];
    const config: ReactionWorkerConfig = {
        chainId: 12,
        workerName: "event-reaction",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };
    const handler: EventReactionHandler = {
        handle: async (event) => {
            handled.push([event.blockNumber, event.transactionIndex, event.index]);
        },
    };

    const worker = await EventReactionWorker.create({
        config,
        handler,
        overrides: {
            chainCursorRepository: {
                ...createNoopChainCursorRepository(),
                get: async () => ({
                    chainId: 12,
                    lastEnqueuedBlock: 1,
                    lastCommittedBlock: 1,
                    lastCommittedHash: HASH_A,
                    updatedAt: new Date(),
                }),
            },
            eventsRepository: {
                ...createNoopEventsRepository(),
                listAfterPosition: async () => [
                    {
                        chainId: 12,
                        blockNumber: 1,
                        blockHash: HASH_A,
                        transactionIndex: 0,
                        transactionHash: HASH_B,
                        index: 0,
                        address: ADDRESS,
                        topics: [HASH_A],
                        data: DATA,
                    },
                ],
            },
            workerCursorsRepository: {
                ...createNoopWorkerCursorsRepository(),
                get: async () => ({
                    workerName: "event-reaction",
                    chainId: 12,
                    streamType: "event",
                    position: { lastBlockNumber: 0, lastTransactionIndex: 0, lastLogIndex: 0 },
                    updatedAt: new Date(),
                }),
            },
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(handled).toEqual([[1, 0, 0]]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 12,
        workerName: "event-reaction",
        batchSize: 10,
    });
});
