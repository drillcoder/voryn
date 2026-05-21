import type { TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";
import {
    ADDRESS,
    createNoopChainCursorRepository,
    createNoopTransactionsRepository,
    createNoopWorkerCursorsRepository,
    DATA,
    HASH_A,
    HASH_B,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
} from "../helpers/pipeline-test-helpers.js";

test("transaction reaction worker create wires service execution", async () => {
    const handled: Array<[number, number]> = [];
    const config: ReactionWorkerConfig = {
        chainId: 13,
        workerName: "transaction-reaction",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
        skipFlushInterval: 10,
    };
    const handler: TransactionReactionHandler = {
        handle: async (transaction) => {
            handled.push([transaction.blockNumber, transaction.index]);

            return "processed";
        },
    };

    const worker = await TransactionReactionWorker.create({
        config,
        handler,
        overrides: {
            chainCursorRepository: {
                ...createNoopChainCursorRepository(),
                get: async () => ({
                    chainId: 13,
                    lastEnqueuedBlock: 1,
                    lastCommittedBlock: 1,
                    lastCommittedHash: HASH_A,
                    updatedAt: new Date(),
                }),
            },
            transactionsRepository: {
                ...createNoopTransactionsRepository(),
                listAfterPosition: async () => [
                    {
                        chainId: 13,
                        blockNumber: 1,
                        blockHash: HASH_A,
                        index: 0,
                        hash: HASH_B,
                        from: ADDRESS,
                        to: ADDRESS,
                        value: "1",
                        data: DATA,
                    },
                ],
            },
            workerCursorsRepository: {
                ...createNoopWorkerCursorsRepository(),
                get: async () => ({
                    workerName: "transaction-reaction",
                    chainId: 13,
                    streamType: "transaction",
                    position: { lastBlockNumber: 0, lastTransactionIndex: 0 },
                    updatedAt: new Date(),
                }),
            },
            leaderLock,
        },
    });

    await invokeTick(worker);

    expect(handled).toEqual([[1, 0]]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 13,
        workerName: "transaction-reaction",
        batchSize: 10,
    });
});
