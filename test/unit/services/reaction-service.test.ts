import type { Logger } from "../../../src/interfaces/logger.js";
import type { PipelineEvent, PipelineTransaction, WorkerCursorPosition } from "../../../src/interfaces/pipeline.js";
import type {
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { ReactionServiceConfig } from "../../../src/services/reaction-service.js";
import { ReactionService } from "../../../src/services/reaction-service.js";
import type { StreamType } from "../../../src/types/pipeline.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

const config: ReactionServiceConfig = {
    chainId: 5,
    workerName: "reaction-handler",
    delayBetweenTicksMs: 1000,
    batchSize: 10,
    skipFlushInterval: 10,
};

const createEvent = (blockNumber: number, transactionIndex: number, index: number): PipelineEvent => ({
    chainId: 5,
    blockNumber,
    blockHash: HASH_A,
    transactionIndex,
    transactionHash: HASH_B,
    index,
    address: ADDRESS,
    topics: [HASH_A],
    data: DATA,
});

const createTransaction = (blockNumber: number, index: number): PipelineTransaction => ({
    chainId: 5,
    blockNumber,
    blockHash: HASH_A,
    index,
    hash: HASH_B,
    from: ADDRESS,
    to: ADDRESS,
    value: "1",
    data: DATA,
});

const createChainCursorRepository = (lastCommittedBlock: number | null = 101): ChainCursorRepository => ({
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

const createWorkerCursorsRepository = (
    position: WorkerCursorPosition | null,
    streamType: StreamType = "event",
    overrides: Partial<WorkerCursorsRepository> = {},
): WorkerCursorsRepository => ({
    get: async () => position === null
        ? null
        : {
            workerName: config.workerName,
            chainId: config.chainId,
            streamType,
            position,
            updatedAt: new Date(),
        },
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
    ...overrides,
});

const createEventsRepository = (overrides: Partial<EventsRepository> = {}): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange: async () => 0,
    deleteByBlockNumber: async () => 0,
    ...overrides,
});

const createTransactionsRepository = (
    overrides: Partial<TransactionsRepository> = {},
): TransactionsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteBlockNumberRange: async () => 0,
    deleteByBlockNumber: async () => 0,
    ...overrides,
});

const createLogger = (): { logger: Logger; debug: jest.Mock; info: jest.Mock } => {
    const debug = jest.fn();
    const info = jest.fn();

    return {
        logger: {
            debug,
            info,
            warn: jest.fn(),
            error: jest.fn(),
        },
        debug,
        info,
    };
};

test("reaction service reads committed events by cursor and advances processed positions", async () => {
    const handled: Array<[number, number, number]> = [];
    const advanced: WorkerCursorPosition[] = [];
    const listCalls: unknown[] = [];
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async (event) => {
                handled.push([event.blockNumber, event.transactionIndex, event.index]);

                return "processed";
        },
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1, lastLogIndex: 2 },
            "event",
            {
                advance: async (_workerName, _chainId, _streamType, position) => {
                    advanced.push(position);
                },
            }
        ),
        eventsRepository: createEventsRepository({
            listAfterPosition: async (...args) => {
                listCalls.push(args);

                return [
                    createEvent(100, 0, 0),
                    createEvent(101, 0, 1),
                ];
            },
        }),
    });

    await service.execute();

    expect(listCalls).toEqual([[5, 101, 99, 1, 2, 10]]);
    expect(handled).toEqual([[100, 0, 0], [101, 0, 1]]);
    expect(advanced).toEqual([
        { lastBlockNumber: 100, lastTransactionIndex: 0, lastLogIndex: 0 },
        { lastBlockNumber: 101, lastTransactionIndex: 0, lastLogIndex: 1 },
    ]);
});

test("reaction service batches skipped transaction cursor advances", async () => {
    const advanced: WorkerCursorPosition[] = [];
    const service = new ReactionService({
        config: { ...config, skipFlushInterval: 2 },
        streamType: "transaction",
        handler: async () => "skipped",
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1 },
            "transaction",
            {
                advance: async (_workerName, _chainId, _streamType, position) => {
                    advanced.push(position);
                },
            }
        ),
        transactionsRepository: createTransactionsRepository({
            listAfterPosition: async () => [
                createTransaction(100, 0),
                createTransaction(100, 1),
                createTransaction(101, 0),
            ],
        }),
    });

    await service.execute();

    expect(advanced).toEqual([
        { lastBlockNumber: 100, lastTransactionIndex: 1 },
        { lastBlockNumber: 101, lastTransactionIndex: 0 },
    ]);
});

test("reaction service advances processed transaction immediately after skipped", async () => {
    const advanced: WorkerCursorPosition[] = [];
    const service = new ReactionService({
        config,
        streamType: "transaction",
        handler: async (transaction) => transaction.index === 0
            ? "skipped"
            : "processed",
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1 },
            "transaction",
            {
                advance: async (_workerName, _chainId, _streamType, position) => {
                    advanced.push(position);
                },
            }
        ),
        transactionsRepository: createTransactionsRepository({
            listAfterPosition: async () => [
                createTransaction(100, 0),
                createTransaction(101, 1),
            ],
        }),
    });

    await service.execute();

    expect(advanced).toEqual([
        { lastBlockNumber: 101, lastTransactionIndex: 1 },
    ]);
});

test("reaction service logs batches with processed items at info level", async () => {
    const { logger, debug, info } = createLogger();
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async (event) => event.index === 0 ? "skipped" : "processed",
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1, lastLogIndex: 2 }
        ),
        eventsRepository: createEventsRepository({
            listAfterPosition: async () => [
                createEvent(100, 0, 0),
                createEvent(101, 0, 1),
            ],
        }),
        logger,
    });

    await service.execute();

    expect(info).toHaveBeenCalledWith("event_reaction_tick_scanned", {
        chainId: 5,
        workerName: "reaction-handler",
        processed: 1,
        skipped: 1,
        lastAdvancedPosition: { lastBlockNumber: 101, lastTransactionIndex: 0, lastLogIndex: 1 },
    });
    expect(debug).not.toHaveBeenCalled();
});

test("reaction service logs batches with only skipped items at debug level", async () => {
    const { logger, debug, info } = createLogger();
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async () => "skipped",
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1, lastLogIndex: 2 }
        ),
        eventsRepository: createEventsRepository({
            listAfterPosition: async () => [createEvent(100, 0, 0)],
        }),
        logger,
    });

    await service.execute();

    expect(debug).toHaveBeenCalledWith("event_reaction_tick_scanned", {
        chainId: 5,
        workerName: "reaction-handler",
        processed: 0,
        skipped: 1,
        lastAdvancedPosition: { lastBlockNumber: 100, lastTransactionIndex: 0, lastLogIndex: 0 },
    });
    expect(info).not.toHaveBeenCalled();
});

test("reaction service flushes skipped transaction position before handler failure", async () => {
    const advanced: WorkerCursorPosition[] = [];
    const service = new ReactionService({
        config,
        streamType: "transaction",
        handler: async (transaction) => {
                if (transaction.index === 1) {
                    throw new Error("handler failed");
                }

                return "skipped";
        },
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 99, lastTransactionIndex: 1 },
            "transaction",
            {
                advance: async (_workerName, _chainId, _streamType, position) => {
                    advanced.push(position);
                },
            }
        ),
        transactionsRepository: createTransactionsRepository({
            listAfterPosition: async () => [
                createTransaction(100, 0),
                createTransaction(100, 1),
            ],
        }),
    });

    await expect(service.execute()).rejects.toThrow("handler failed");

    expect(advanced).toEqual([
        { lastBlockNumber: 100, lastTransactionIndex: 0 },
    ]);
});

test("reaction service creates event cursor at current committed block when missing", async () => {
    const inserts: WorkerCursorPosition[] = [];
    const listCalls: unknown[] = [];
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async () => "processed" ,
        chainCursorRepository: createChainCursorRepository(22),
        workerCursorsRepository: createWorkerCursorsRepository(null, "event", {
            insert: async (_workerName, _chainId, _streamType, position) => {
                inserts.push(position);
            },
        }),
        eventsRepository: createEventsRepository({
            listAfterPosition: async (...args) => {
                listCalls.push(args);

                return [];
            },
        }),
    });

    await service.execute();

    expect(inserts).toEqual([
        { lastBlockNumber: 22, lastTransactionIndex: -1, lastLogIndex: -1 },
    ]);
    expect(listCalls).toEqual([[5, 22, 22, -1, -1, 10]]);
});

test("reaction service creates transaction cursor at current committed block when missing", async () => {
    const inserts: WorkerCursorPosition[] = [];
    const listCalls: unknown[] = [];
    const service = new ReactionService({
        config,
        streamType: "transaction",
        handler: async () => "processed" ,
        chainCursorRepository: createChainCursorRepository(33),
        workerCursorsRepository: createWorkerCursorsRepository(null, "transaction", {
            insert: async (_workerName, _chainId, _streamType, position) => {
                inserts.push(position);
            },
        }),
        transactionsRepository: createTransactionsRepository({
            listAfterPosition: async (...args) => {
                listCalls.push(args);

                return [];
            },
        }),
    });

    await service.execute();

    expect(inserts).toEqual([
        { lastBlockNumber: 33, lastTransactionIndex: -1 },
    ]);
    expect(listCalls).toEqual([[5, 33, 33, -1, 10]]);
});

test("reaction service throws when chain cursor is missing", async () => {
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async () => "processed" ,
        chainCursorRepository: createChainCursorRepository(null),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 1, lastTransactionIndex: 0, lastLogIndex: 0 }
        ),
        eventsRepository: createEventsRepository(),
    });

    await expect(service.execute()).rejects.toThrow("Chain cursor is missing for event reaction chain 5");
});

test("reaction service reports transaction stream when transaction chain cursor is missing", async () => {
    const service = new ReactionService({
        config,
        streamType: "transaction",
        handler: async () => "processed" ,
        chainCursorRepository: createChainCursorRepository(null),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 1, lastTransactionIndex: 0 },
            "transaction"
        ),
        transactionsRepository: createTransactionsRepository(),
    });

    await expect(service.execute()).rejects.toThrow("Chain cursor is missing for transaction reaction chain 5");
});

test("reaction service validates event cursor before listing items", async () => {
    const service = new ReactionService({
        config,
        streamType: "event",
        handler: async () => "processed" ,
        chainCursorRepository: createChainCursorRepository(),
        workerCursorsRepository: createWorkerCursorsRepository(
            { lastBlockNumber: 1, lastTransactionIndex: 0, lastLogIndex: null }
        ),
        eventsRepository: createEventsRepository(),
    });

    await expect(service.execute()).rejects.toThrow(
        "Event worker cursor has no log index for worker \"reaction-handler\", chain 5"
    );
});
