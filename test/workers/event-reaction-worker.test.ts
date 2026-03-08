import type { EventReactionHandler, EventStreamStore, ReactionConfig, WorkerCursorStore } from "../../src/index.js";
import { EventReactionWorker } from "../../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("event reaction worker processes events and advances cursor", async () => {
    const handled: bigint[] = [];
    const advanced: bigint[] = [];

    const config: ReactionConfig = {
        chainId: 5,
        workerName: "ev-handler",
        pollIntervalMs: 1000,
        batchSize: 10,
    };

    const handler: EventReactionHandler = {
        handle: async (event) => {
            handled.push(event.seq);
        },
    };

    const eventStore: EventStreamStore = {
        readFromSeq: async () => [
            {
                seq: 11n,
                chainId: 5,
                blockNumber: 100,
                txIndex: 0,
                logIndex: 0,
                payload: { v: 1 },
            },
            {
                seq: 12n,
                chainId: 5,
                blockNumber: 101,
                txIndex: 0,
                logIndex: 1,
                payload: { v: 2 },
            },
        ],
    };

    const cursorStore: WorkerCursorStore = {
        get: async () => ({
            workerName: "ev-handler",
            chainId: 5,
            streamType: "event",
            lastSeq: 10n,
            updatedAt: new Date(),
        }),
        advance: async (_workerName, _chainId, _streamType, seq) => {
            advanced.push(seq);
        },
    };

    const worker = new EventReactionWorker({
        config,
        handler,
        eventStore,
        cursorStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(handled).toEqual([11n, 12n]);
    expect(advanced).toEqual([11n, 12n]);
});
