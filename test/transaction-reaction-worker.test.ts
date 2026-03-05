import type {
    ReactionConfig,
    TransactionReactionHandler,
    TransactionStreamStore,
    WorkerCursorStore,
} from "../src/index.js";
import { TransactionReactionWorker } from "../src/index.js";

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const lock = { tryAcquire: async () => true, release: async () => undefined };

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
                txIndex: 1,
                txHash: "0xabc",
                payload: { amount: 1 },
            },
            {
                seq: 102n,
                chainId: 9,
                blockNumber: 201,
                txIndex: 2,
                txHash: "0xdef",
                payload: { amount: 2 },
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
        leaderLock: lock,
    });

    await invokeTick(worker);

    expect(handled).toEqual([101n, 102n]);
    expect(advanced).toEqual([101n, 102n]);
});
