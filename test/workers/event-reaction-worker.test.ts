import type { EventReactionHandler, EventStreamStore, ReactionConfig, WorkerCursorStore } from "../../src/index.js";
import { EventReactionWorker } from "../../src/index.js";
import type { AddressHex, DataHex, HashHex } from "../../src/types/chain.js";

const BLOCK_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const TX_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const ADDRESS = "0x1111111111111111111111111111111111111111" as AddressHex;
const TOPIC = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as HashHex;
const DATA = "0x01" as DataHex;

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
                blockHash: BLOCK_HASH,
                transactionIndex: 0,
                transactionHash: TX_HASH,
                index: 0,
                address: ADDRESS,
                topics: [TOPIC],
                data: DATA,
                raw: { v: 1 },
            },
            {
                seq: 12n,
                chainId: 5,
                blockNumber: 101,
                blockHash: BLOCK_HASH,
                transactionIndex: 0,
                transactionHash: TX_HASH,
                index: 1,
                address: ADDRESS,
                topics: [TOPIC],
                data: DATA,
                raw: { v: 2 },
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
