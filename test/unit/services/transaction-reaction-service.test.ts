import type { WorkerCursorPosition } from "../../../src/interfaces/pipeline.js";
import type { TransactionReactionHandler } from "../../../src/interfaces/reaction.js";
import type {
    ChainCursorRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { TransactionReactionService } from "../../../src/services/transaction-reaction-service.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const FROM = asAddress("0x1111111111111111111111111111111111111111");
const TO = asAddress("0x2222222222222222222222222222222222222222");
const DATA = asHexData("0x01");

const config: ReactionWorkerConfig = {
    chainId: 9,
    workerName: "tx-handler",
    delayBetweenTicksMs: 1000,
    batchSize: 10,
};

const createChainCursorRepository = (lastCommittedBlock: number | null = 201): ChainCursorRepository => ({
    get: async (chainId) => lastCommittedBlock === null
        ? null
        : {
            chainId,
            lastEnqueuedBlock: lastCommittedBlock,
            lastCommittedBlock,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        },
    getForUpdate: async () => null,
    insert: async () => undefined,
    setLastEnqueued: async () => undefined,
    setPositions: async () => undefined,
    advanceLastCommitted: async () => undefined,
});

const createTransactionsRepository = (
    overrides: Partial<TransactionsRepository> = {},
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
    deleteByBlockNumber: async () => 0,
    deleteAfterBlockNumber: async () => 0,
    ...overrides,
});

const createWorkerCursorsRepository = (
    position: WorkerCursorPosition | null,
    overrides: Partial<WorkerCursorsRepository> = {},
): WorkerCursorsRepository => ({
    get: async () => position === null
        ? null
        : {
            workerName: config.workerName,
            chainId: config.chainId,
            streamType: "tx",
            position,
            updatedAt: new Date(),
        },
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
    ...overrides,
});

test("transaction reaction service reads committed transactions by position and advances cursor", async () => {
    const handled: Array<[number, number]> = [];
    const advanced: WorkerCursorPosition[] = [];

    const handler: TransactionReactionHandler = {
        handle: async (tx) => {
            handled.push([tx.blockNumber, tx.index]);
        },
    };

    const transactionsRepository = createTransactionsRepository({
        listAfterPosition: async (
            chainId,
            maxBlockNumber,
            afterBlockNumber,
            afterTransactionIndex,
            limit
        ) => {
            expect([chainId, maxBlockNumber, afterBlockNumber, afterTransactionIndex, limit])
                .toEqual([9, 201, 199, 1, 10]);

            return [
                {
                    chainId: 9,
                    blockNumber: 200,
                    blockHash: HASH_A,
                    index: 1,
                    hash: HASH_B,
                    from: FROM,
                    to: TO,
                    value: "1",
                    data: DATA,
                },
                {
                    chainId: 9,
                    blockNumber: 201,
                    blockHash: HASH_A,
                    index: 2,
                    hash: HASH_A,
                    from: FROM,
                    to: null,
                    value: "2",
                    data: DATA,
                },
            ];
        },
    });

    const workerCursorsRepository = createWorkerCursorsRepository(
        { lastBlockNumber: 199, lastTransactionIndex: 1 },
        {
            advance: async (_workerName, _chainId, _streamType, position) => {
                advanced.push(position);
            },
        }
    );

    const worker = new TransactionReactionService(
        config,
        handler,
        createChainCursorRepository(),
        transactionsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(handled).toEqual([[200, 1], [201, 2]]);
    expect(advanced).toEqual([
        { lastBlockNumber: 200, lastTransactionIndex: 1 },
        { lastBlockNumber: 201, lastTransactionIndex: 2 },
    ]);
});

test("transaction reaction service creates cursor at current committed block when missing", async () => {
    const inserts: WorkerCursorPosition[] = [];
    const listCalls: unknown[] = [];
    const workerCursorsRepository = createWorkerCursorsRepository(null, {
        insert: async (_workerName, _chainId, _streamType, position) => {
            inserts.push(position);
        },
    });

    const worker = new TransactionReactionService(
        config,
        { handle: async () => undefined },
        createChainCursorRepository(33),
        createTransactionsRepository({
            listAfterPosition: async (...args) => {
                listCalls.push(args);

                return [];
            },
        }),
        workerCursorsRepository,
    );

    await worker.execute();

    expect(inserts).toEqual([
        { lastBlockNumber: 33, lastTransactionIndex: -1 },
    ]);
    expect(listCalls).toEqual([[9, 33, 33, -1, 10]]);
});

test("transaction reaction service throws when chain cursor is missing", async () => {
    const worker = new TransactionReactionService(
        config,
        { handle: async () => undefined },
        createChainCursorRepository(null),
        createTransactionsRepository(),
        createWorkerCursorsRepository({ lastBlockNumber: 1, lastTransactionIndex: 0 }),
    );

    await expect(worker.execute()).rejects.toThrow("Chain cursor is missing for transaction reaction chain 9");
});
