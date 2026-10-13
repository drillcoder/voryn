import { expect, test } from "vitest";

import type { TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type { ReactionServiceConfig } from "../../../src/services/reaction-service.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";
import {
    ADDRESS,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopTransactionsRepository,
    createNoopWorkerCursorsRepository,
    DATA,
    HASH_A,
    HASH_B,
    invokeStartLogMeta,
    invokeTick,
    leaderLock,
    transactionManager,
} from "../helpers/pipeline-test-helpers.js";

test.each([true, false])("transaction worker wires execution (filter=%s)", async (withFilter) => {
    const handled: Array<[number, number]> = [];
    const filtered: number[] = [];
    let accept = true;
    const config: ReactionServiceConfig = {
        chainId: 13,
        workerName: "transaction-reaction",
        delayBetweenTicksMs: 1000,
        batchSize: 10,
        confirmations: 0,
    };
    const handler: TransactionReactionHandler = async (transaction) => {
        handled.push([transaction.blockNumber, transaction.index]);

        return;
    };

    const worker = await TransactionReactionWorker.create({
        logLevel: "error",
        ...config,
        ...(withFilter ? { filter: (item: Parameters<TransactionReactionHandler>[0]) => {
            filtered.push(item.index); return accept;
        } } : {}),
        handler,
        overrides: {
            blocksRepository: createNoopBlocksRepository(),
            chainCursorRepository: {
                ...createNoopChainCursorRepository(),
                get: async () => ({
                    chainId: 13,
                    lastEnqueuedBlock: 1,
                    lastCommittedBlock: 1,
                    lastCommittedHash: HASH_A,
                    reorgVersion: 0,
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
                    position: { lastBlockNumber: 0, lastTransactionIndex: 0, lastLogIndex: -1 },
                    reorgVersion: 0,
                    updatedAt: new Date(),
                }),
            },
            leaderLock,
            transactionManager,
        },
    });

    await invokeTick(worker);

    accept = false;
    await invokeTick(worker);
    expect(filtered).toEqual(withFilter ? [0, 0] : []);
    expect(handled).toEqual(withFilter ? [[1, 0]] : [[1, 0], [1, 0]]);
    expect(invokeStartLogMeta(worker)).toEqual({
        chainId: 13,
        workerName: "transaction-reaction",
        batchSize: 10,
        confirmations: 0,
    });
});
