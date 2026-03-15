import type {
    AddressHex,
    DataHex,
    HashHex,
    ReactionConfig,
    TransactionReactionHandler,
    TransactionStreamStore,
    WorkerCursorStore,
} from "../../src/index.js";
import { TransactionReactionWorker } from "../../src/index.js";

const BLOCK_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const TX_HASH_A = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const TX_HASH_B = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as HashHex;
const FROM = "0x1111111111111111111111111111111111111111" as AddressHex;
const TO = "0x2222222222222222222222222222222222222222" as AddressHex;
const DATA = "0x01" as DataHex;

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

test("transaction reaction worker processes txs and advances cursor", async () => {
    const handled: bigint[] = [];
    const advanced: bigint[] = [];

    const config: ReactionConfig = {
        chainId: 9,
        workerName: "tx-handler",
        pollIntervalMs: 1000,
        batchSize: 10,
    };

    const handler: TransactionReactionHandler = {
        handle: async (tx) => {
            handled.push(tx.seq);
        },
    };

    const txStore: TransactionStreamStore = {
        readFromSeq: async () => [
            {
                seq: 101n,
                chainId: 9,
                blockNumber: 200,
                blockHash: BLOCK_HASH,
                index: 1,
                hash: TX_HASH_A,
                from: FROM,
                to: TO,
                value: "1",
                data: DATA,
                raw: { amount: 1 },
            },
            {
                seq: 102n,
                chainId: 9,
                blockNumber: 201,
                blockHash: BLOCK_HASH,
                index: 2,
                hash: TX_HASH_B,
                from: FROM,
                to: null,
                value: "2",
                data: DATA,
                raw: { amount: 2 },
            },
        ],
    };

    const cursorStore: WorkerCursorStore = {
        get: async () => ({
            workerName: "tx-handler",
            chainId: 9,
            streamType: "tx",
            lastSeq: 100n,
            updatedAt: new Date(),
        }),
        advance: async (_workerName, _chainId, _streamType, seq) => {
            advanced.push(seq);
        },
    };

    const worker = new TransactionReactionWorker({
        config,
        handler,
        txStore,
        cursorStore,
        leaderLock: { tryAcquire: async () => true, release: async () => undefined },
    });

    await invokeTick(worker);

    expect(handled).toEqual([101n, 102n]);
    expect(advanced).toEqual([101n, 102n]);
});
