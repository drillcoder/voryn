import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { TransactionReactionService } from "../../../src/services/transaction-reaction-service.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const FROM = asAddress("0x1111111111111111111111111111111111111111");
const TO = asAddress("0x2222222222222222222222222222222222222222");
const DATA = asHexData("0x01");

test("transaction reaction service processes txs and advances cursor", async () => {
    const handled: bigint[] = [];
    const advanced: bigint[] = [];

    const config: ReactionWorkerConfig = {
        chainId: 9,
        workerName: "tx-handler",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };

    const handler: TransactionReactionHandler = {
        handle: async (tx) => {
            handled.push(tx.seq);
        },
    };

    const transactionsRepository: CanonicalTransactionsRepository = {
        readFromSeq: async () => [
            {
                seq: 101n,
                chainId: 9,
                blockNumber: 200,
                blockHash: HASH_A,
                index: 1,
                hash: HASH_B,
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
                blockHash: HASH_A,
                index: 2,
                hash: HASH_A,
                from: FROM,
                to: null,
                value: "2",
                data: DATA,
                raw: { amount: 2 },
            },
        ],
        maxSeq: async () => 0n,
        insertMany: async () => undefined,
        deleteUpToBlock: async () => 0,
    deleteAfterBlock: async () => 0,
    };

    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => ({
            workerName: "tx-handler",
            chainId: 9,
            streamType: "tx",
            lastSeq: 100n,
            updatedAt: new Date(),
        }),
        listByChain: async () => [],
        insert: async () => undefined,
        advance: async (_workerName, _chainId, _streamType, seq) => {
            advanced.push(seq);
        },
    };

    const worker = new TransactionReactionService(
        config,
        handler,
        transactionsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(handled).toEqual([101n, 102n]);
    expect(advanced).toEqual([101n, 102n]);
});

test("transaction reaction service creates cursor from max seq when missing", async () => {
    const inserts: bigint[] = [];
    const config: ReactionWorkerConfig = {
        chainId: 9,
        workerName: "tx-handler",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };

    const transactionsRepository: CanonicalTransactionsRepository = {
        readFromSeq: async () => [],
        maxSeq: async () => 33n,
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

    const worker = new TransactionReactionService(
        config,
        { handle: async () => undefined },
        transactionsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(inserts).toEqual([33n]);
});
