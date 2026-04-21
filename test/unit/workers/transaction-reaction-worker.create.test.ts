import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../../../src/interfaces/repositories.js";
import type { TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";
import {
    ADDRESS,
    createNoopCanonicalTransactionsRepository,
    DATA,
    HASH_A,
    HASH_B,
    invokeTick,
    leaderLock,
} from "./worker-test-helpers.js";

test("transaction reaction worker create wires service execution", async () => {
    const handled: bigint[] = [];
    const config: ReactionWorkerConfig = {
        chainId: 13,
        workerName: "tx-reaction",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
    };
    const handler: TransactionReactionHandler = {
        handle: async (transaction) => {
            handled.push(transaction.seq);
        },
    };
    const workerCursorsRepository: WorkerCursorsRepository = {
        get: async () => ({
            workerName: "tx-reaction",
            chainId: 13,
            streamType: "tx",
            lastSeq: 0n,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        advance: async () => undefined,
    };
    const canonicalTransactionsRepository: CanonicalTransactionsRepository = {
        ...createNoopCanonicalTransactionsRepository(),
        readFromSeq: async () => [
            {
                seq: 1n,
                chainId: 13,
                blockNumber: 1,
                blockHash: HASH_A,
                index: 0,
                hash: HASH_B,
                from: ADDRESS,
                to: ADDRESS,
                value: "1",
                data: DATA,
                raw: {},
            },
        ],
    };

    const worker = TransactionReactionWorker.create({
        config,
        handler,
        overrides: {
            transactionsRepository: canonicalTransactionsRepository,
            workerCursorsRepository,
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(handled).toEqual([1n]);
});
