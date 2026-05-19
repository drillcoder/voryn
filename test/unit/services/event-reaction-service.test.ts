import type { WorkerCursorPosition } from "../../../src/interfaces/pipeline.js";
import type { EventReactionHandler } from "../../../src/interfaces/reaction.js";
import type {
    ChainCursorRepository,
    EventsRepository,
    WorkerCursorsRepository,
} from "../../../src/interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../../../src/interfaces/runtime.js";
import { EventReactionService } from "../../../src/services/event-reaction-service.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

const config: ReactionWorkerConfig = {
    chainId: 5,
    workerName: "ev-handler",
    delayBetweenTicksMs: 1000,
    batchSize: 10,
};

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

const createEventsRepository = (overrides: Partial<EventsRepository> = {}): EventsRepository => ({
    listAfterPosition: async () => [],
    insertMany: async () => undefined,
    deleteAtOrBeforeBlockNumber: async () => 0,
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
            streamType: "event",
            position,
            updatedAt: new Date(),
        },
    listByChain: async () => [],
    insert: async () => undefined,
    advance: async () => undefined,
    ...overrides,
});

test("event reaction service reads committed events by position and advances cursor", async () => {
    const handled: Array<[number, number, number]> = [];
    const advanced: WorkerCursorPosition[] = [];

    const handler: EventReactionHandler = {
        handle: async (event) => {
            handled.push([event.blockNumber, event.transactionIndex, event.index]);
        },
    };

    const eventsRepository = createEventsRepository({
        listAfterPosition: async (
            chainId,
            maxBlockNumber,
            afterBlockNumber,
            afterTransactionIndex,
            afterLogIndex,
            limit
        ) => {
            expect([chainId, maxBlockNumber, afterBlockNumber, afterTransactionIndex, afterLogIndex, limit])
                .toEqual([5, 101, 99, 1, 2, 10]);

            return [
                {
                    chainId: 5,
                    blockNumber: 100,
                    blockHash: HASH_A,
                    transactionIndex: 0,
                    transactionHash: HASH_B,
                    index: 0,
                    address: ADDRESS,
                    topics: [HASH_A],
                    data: DATA,
                },
                {
                    chainId: 5,
                    blockNumber: 101,
                    blockHash: HASH_A,
                    transactionIndex: 0,
                    transactionHash: HASH_B,
                    index: 1,
                    address: ADDRESS,
                    topics: [HASH_A],
                    data: DATA,
                },
            ];
        },
    });

    const workerCursorsRepository = createWorkerCursorsRepository(
        { lastBlockNumber: 99, lastTransactionIndex: 1, lastLogIndex: 2 },
        {
            advance: async (_workerName, _chainId, _streamType, position) => {
                advanced.push(position);
            },
        }
    );

    const worker = new EventReactionService(
        config,
        handler,
        createChainCursorRepository(),
        eventsRepository,
        workerCursorsRepository,
    );

    await worker.execute();

    expect(handled).toEqual([[100, 0, 0], [101, 0, 1]]);
    expect(advanced).toEqual([
        { lastBlockNumber: 100, lastTransactionIndex: 0, lastLogIndex: 0 },
        { lastBlockNumber: 101, lastTransactionIndex: 0, lastLogIndex: 1 },
    ]);
});

test("event reaction service creates cursor at current committed block when missing", async () => {
    const inserts: WorkerCursorPosition[] = [];
    const listCalls: unknown[] = [];
    const workerCursorsRepository = createWorkerCursorsRepository(null, {
        insert: async (_workerName, _chainId, _streamType, position) => {
            inserts.push(position);
        },
    });

    const worker = new EventReactionService(
        config,
        { handle: async () => undefined },
        createChainCursorRepository(22),
        createEventsRepository({
            listAfterPosition: async (...args) => {
                listCalls.push(args);

                return [];
            },
        }),
        workerCursorsRepository,
    );

    await worker.execute();

    expect(inserts).toEqual([
        { lastBlockNumber: 22, lastTransactionIndex: -1, lastLogIndex: -1 },
    ]);
    expect(listCalls).toEqual([[5, 22, 22, -1, -1, 10]]);
});

test("event reaction service throws when chain cursor is missing", async () => {
    const worker = new EventReactionService(
        config,
        { handle: async () => undefined },
        createChainCursorRepository(null),
        createEventsRepository(),
        createWorkerCursorsRepository({ lastBlockNumber: 1, lastTransactionIndex: 0, lastLogIndex: 0 }),
    );

    await expect(worker.execute()).rejects.toThrow("Chain cursor is missing for event reaction chain 5");
});

test("event reaction service throws when cursor log index is missing", async () => {
    const worker = new EventReactionService(
        config,
        { handle: async () => undefined },
        createChainCursorRepository(),
        createEventsRepository(),
        createWorkerCursorsRepository({ lastBlockNumber: 1, lastTransactionIndex: 0, lastLogIndex: null }),
    );

    await expect(worker.execute()).rejects.toThrow(
        "Event worker cursor has no log index for worker \"ev-handler\", chain 5"
    );
});
