import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { EventReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { EventReactionService } from "../../../src/services/event-reaction-service.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

test("event reaction service processes events and advances cursor", async () => {
    const handled: bigint[] = [];
    const advanced: bigint[] = [];

    const config: ReactionWorkerConfig = {
        chainId: 5,
        workerName: "ev-handler",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };

    const handler: EventReactionHandler = {
        handle: async (event) => {
            handled.push(event.seq);
        },
    };

    const eventsRepository: CanonicalEventsRepository = {
        readFromSeq: async () => [
            {
                seq: 11n,
                chainId: 5,
                blockNumber: 100,
                blockHash: HASH_A,
                transactionIndex: 0,
                transactionHash: HASH_B,
                index: 0,
                address: ADDRESS,
                topics: [HASH_A],
                data: DATA,
            },
            {
                seq: 12n,
                chainId: 5,
                blockNumber: 101,
                blockHash: HASH_A,
                transactionIndex: 0,
                transactionHash: HASH_B,
                index: 1,
                address: ADDRESS,
                topics: [HASH_A],
                data: DATA,
            },
        ],
        maxSeq: async () => 0n,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    };

    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => ({
            workerName: "ev-handler",
            chainId: 5,
            streamType: "event",
            lastSeq: 10n,
            updatedAt: new Date(),
        }),
        listByChain: async () => [],
        insert: async () => undefined,
        advance: async (_workerName, _chainId, _streamType, seq) => {
            advanced.push(seq);
        },
    };

    const worker = new EventReactionService(
        config,
        handler,
        eventsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(handled).toEqual([11n, 12n]);
    expect(advanced).toEqual([11n, 12n]);
});

test("event reaction service creates cursor from max seq when missing", async () => {
    const inserts: bigint[] = [];
    const config: ReactionWorkerConfig = {
        chainId: 5,
        workerName: "ev-handler",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };

    const eventsRepository: CanonicalEventsRepository = {
        readFromSeq: async () => [],
        maxSeq: async () => 22n,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    };
    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => null,
        listByChain: async () => [],
        insert: async (_workerName, _chainId, _streamType, lastSeq) => {
            inserts.push(lastSeq);
        },
        advance: async () => undefined,
    };

    const worker = new EventReactionService(
        config,
        { handle: async () => undefined },
        eventsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(inserts).toEqual([22n]);
});
