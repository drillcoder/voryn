import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { EventReactionHandler } from "../../../src/interfaces/reaction.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("event reaction worker processes events and advances cursor", async () => {
    const handled: bigint[] = [];
    const advanced: bigint[] = [];

    const config: ReactionWorkerConfig = {
        chainId: 5,
        workerName: "ev-handler",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };
    const leaderLock: LeaderLock = { tryAcquire: async () => true, release: async () => undefined };

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
                raw: { v: 1 },
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
                raw: { v: 2 },
            },
        ],
        maxSeq: async () => 0n,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
    };

    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => ({
            workerName: "ev-handler",
            chainId: 5,
            streamType: "event",
            lastSeq: 10n,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        advance: async (_workerName, _chainId, _streamType, seq) => {
            advanced.push(seq);
        },
    };

    const worker = new EventReactionWorker(
        config,
        handler,
        eventsRepository,
        workerCursorsRepository,
        leaderLock,
    );

    await invokeTick(worker);

    expect(handled).toEqual([11n, 12n]);
    expect(advanced).toEqual([11n, 12n]);
});

test("event reaction worker creates cursor from max seq when missing", async () => {
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
    };
    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => null,
        insert: async (_workerName, _chainId, _streamType, lastSeq) => {
            inserts.push(lastSeq);
        },
        advance: async () => undefined,
    };

    const worker = new EventReactionWorker(
        config,
        { handle: async () => undefined },
        eventsRepository,
        workerCursorsRepository,
        { tryAcquire: async () => true, release: async () => undefined },
    );

    await invokeTick(worker);

    expect(inserts).toEqual([22n]);
});
