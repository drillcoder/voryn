import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    DbExecutor,
    LeaderLock,
    RawBlocksRepository,
    TransactionManager,
} from "../../../src/index.js";
import type { SequencerWorkerConfig } from "../../../src/interfaces/runtime.js";
import { SequencerWorker } from "../../../src/index.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const invokeTick = async (worker: object): Promise<void> => {
    await (worker as { tick: () => Promise<void> }).tick();
};

const leaderLock: LeaderLock = { tryAcquire: async () => true, release: async () => undefined };

const createPassThroughManager = (): { manager: TransactionManager; transaction: DbExecutor } => {
    const transaction: DbExecutor = { query: async () => ({ rows: [], rowCount: 0 }) };
    return {
        transaction,
        manager: { run: async (callback) => callback(transaction) },
    };
};

const emptyCanonicalTransactionsRepository: CanonicalTransactionsRepository = {
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
};

const emptyCanonicalEventsRepository: CanonicalEventsRepository = {
    readFromSeq: async () => [],
    maxSeq: async () => 0n,
    insertMany: async () => undefined,
    deleteUpToBlock: async () => 0,
};

const noopBlockJobsRepository: BlockJobsRepository = {
    enqueueRange: async () => undefined,
    claimForFetch: async () => null,
    markFetched: async () => undefined,
    markFetchFailed: async () => undefined,
    markCommitted: async () => undefined,
    deleteUpToBlock: async () => 0,
};

test("sequencer worker commits next block", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const config: SequencerWorkerConfig = { chainId: 10, delayBetweenTicksMs: 1000, maxBlocksPerTick: 1 };

    const chainCursorRepository: ChainCursorRepository = {
        get: async () => ({
            chainId: 10,
            lastEnqueuedBlock: 50,
            lastCommittedBlock: 40,
            lastCommittedHash: HASH_A,
            updatedAt: new Date(),
        }),
        insert: async () => undefined,
        setLastEnqueued: async () => undefined,
        setLastCommitted: async () => undefined,
        setPositions: async () => undefined,
        advanceLastCommitted: async (_cid, _prevN, _prevH, blockN, _hash, tx) => {
            calls.push(`advance:${String(blockN)}:${String(tx === transaction)}`);
        },
    };

    const rawBlocksRepository: RawBlocksRepository = {
        save: async () => undefined,
        get: async () => ({
            chainId: 10,
            blockNumber: 41,
            blockHash: HASH_B,
            parentHash: HASH_A,
            payload: {
                block: {
                    chainId: 10,
                    number: 41,
                    hash: HASH_B,
                    parentHash: HASH_A,
                    timestamp: 1,
                    raw: {},
                },
                transactions: [],
                logs: [],
            },
            fetchedAt: new Date(),
        }),
        deleteUpToBlock: async () => 0,
    };

    const canonicalBlocksRepository: CanonicalBlocksRepository = {
        insert: async () => { calls.push("insert-block"); },
        deleteUpToBlock: async () => 0,
    };
    const canonicalTransactionsRepository: CanonicalTransactionsRepository = {
        readFromSeq: async () => [],
        maxSeq: async () => 0n,
        insertMany: async () => { calls.push("insert-tx"); },
        deleteUpToBlock: async () => 0,
    };
    const canonicalEventsRepository: CanonicalEventsRepository = {
        readFromSeq: async () => [],
        maxSeq: async () => 0n,
        insertMany: async () => { calls.push("insert-event"); },
        deleteUpToBlock: async () => 0,
    };
    const blockJobsRepository: BlockJobsRepository = {
        enqueueRange: async () => undefined,
        claimForFetch: async () => null,
        markFetched: async () => undefined,
        markFetchFailed: async () => undefined,
        markCommitted: async () => { calls.push("mark-committed"); },
        deleteUpToBlock: async () => 0,
    };

    const worker = new SequencerWorker(
        config,
        chainCursorRepository,
        rawBlocksRepository,
        canonicalBlocksRepository,
        canonicalTransactionsRepository,
        canonicalEventsRepository,
        blockJobsRepository,
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(calls).toEqual(["insert-block", "insert-tx", "insert-event", "advance:41:true", "mark-committed"]);
});

test("sequencer worker exits when cursor is missing", async () => {
    const { manager } = createPassThroughManager();
    const worker = new SequencerWorker(
        { chainId: 10, delayBetweenTicksMs: 1000, maxBlocksPerTick: 1 },
        {
            get: async () => null,
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setLastCommitted: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async () => undefined,
        },
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        { insert: async () => undefined, deleteUpToBlock: async () => 0 },
        emptyCanonicalTransactionsRepository,
        emptyCanonicalEventsRepository,
        noopBlockJobsRepository,
        manager,
        leaderLock,
    );

    await expect(invokeTick(worker)).resolves.toBeUndefined();
});

test("sequencer worker commits multiple blocks in one tick", async () => {
    const calls: string[] = [];
    const { manager, transaction } = createPassThroughManager();
    const chainCursor = {
        chainId: 10,
        lastEnqueuedBlock: 50,
        lastCommittedBlock: 40,
        lastCommittedHash: HASH_A,
        updatedAt: new Date(),
    };
    const hash41 = asHash32("0x1111111111111111111111111111111111111111111111111111111111111111");
    const hash42 = asHash32("0x2222222222222222222222222222222222222222222222222222222222222222");

    const worker = new SequencerWorker(
        { chainId: 10, delayBetweenTicksMs: 1000, maxBlocksPerTick: 2 },
        {
            get: async () => chainCursor,
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setLastCommitted: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async (_cid, _prevN, _prevH, blockN, blockHash, tx) => {
                chainCursor.lastCommittedBlock = blockN;
                chainCursor.lastCommittedHash = blockHash;
                calls.push(`advance:${String(blockN)}:${String(tx === transaction)}`);
            },
        },
        {
            save: async () => undefined,
            get: async (_chainId, blockNumber) => {
                if (blockNumber === 41) {
                    return {
                        chainId: 10,
                        blockNumber: 41,
                        blockHash: hash41,
                        parentHash: HASH_A,
                        payload: {
                            block: {
                                chainId: 10,
                                number: 41,
                                hash: hash41,
                                parentHash: HASH_A,
                                timestamp: 1,
                                raw: {},
                            },
                            transactions: [],
                            logs: [],
                        },
                        fetchedAt: new Date(),
                    };
                }

                if (blockNumber === 42) {
                    return {
                        chainId: 10,
                        blockNumber: 42,
                        blockHash: hash42,
                        parentHash: hash41,
                        payload: {
                            block: {
                                chainId: 10,
                                number: 42,
                                hash: hash42,
                                parentHash: hash41,
                                timestamp: 2,
                                raw: {},
                            },
                            transactions: [],
                            logs: [],
                        },
                        fetchedAt: new Date(),
                    };
                }

                return null;
            },
            deleteUpToBlock: async () => 0,
        },
        {
            insert: async (block) => { calls.push(`insert-block:${String(block.number)}`); },
            deleteUpToBlock: async () => 0,
        },
        {
            readFromSeq: async () => [],
            maxSeq: async () => 0n,
            insertMany: async (_chainId, blockNumber) => { calls.push(`insert-tx:${String(blockNumber)}`); },
            deleteUpToBlock: async () => 0,
        },
        {
            readFromSeq: async () => [],
            maxSeq: async () => 0n,
            insertMany: async (_chainId, blockNumber) => { calls.push(`insert-event:${String(blockNumber)}`); },
            deleteUpToBlock: async () => 0,
        },
        {
            enqueueRange: async () => undefined,
            claimForFetch: async () => null,
            markFetched: async () => undefined,
            markFetchFailed: async () => undefined,
            markCommitted: async (_chainId, blockNumber) => { calls.push(`mark-committed:${String(blockNumber)}`); },
            deleteUpToBlock: async () => 0,
        },
        manager,
        leaderLock,
    );

    await invokeTick(worker);

    expect(calls).toEqual([
        "insert-block:41",
        "insert-tx:41",
        "insert-event:41",
        "advance:41:true",
        "mark-committed:41",
        "insert-block:42",
        "insert-tx:42",
        "insert-event:42",
        "advance:42:true",
        "mark-committed:42",
    ]);
});

test("sequencer worker exits when raw block is missing", async () => {
    const { manager } = createPassThroughManager();
    const worker = new SequencerWorker(
        { chainId: 10, delayBetweenTicksMs: 1000, maxBlocksPerTick: 1 },
        {
            get: async () => ({
                chainId: 10,
                lastEnqueuedBlock: 10,
                lastCommittedBlock: 9,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            }),
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setLastCommitted: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async () => undefined,
        },
        { save: async () => undefined, get: async () => null, deleteUpToBlock: async () => 0 },
        { insert: async () => undefined, deleteUpToBlock: async () => 0 },
        emptyCanonicalTransactionsRepository,
        emptyCanonicalEventsRepository,
        noopBlockJobsRepository,
        manager,
        leaderLock,
    );

    await expect(invokeTick(worker)).resolves.toBeUndefined();
});

test("sequencer worker throws on parent hash mismatch", async () => {
    const { manager } = createPassThroughManager();
    const worker = new SequencerWorker(
        { chainId: 10, delayBetweenTicksMs: 1000, maxBlocksPerTick: 1 },
        {
            get: async () => ({
                chainId: 10,
                lastEnqueuedBlock: 10,
                lastCommittedBlock: 9,
                lastCommittedHash: HASH_A,
                updatedAt: new Date(),
            }),
            insert: async () => undefined,
            setLastEnqueued: async () => undefined,
            setLastCommitted: async () => undefined,
            setPositions: async () => undefined,
            advanceLastCommitted: async () => undefined,
        },
        {
            save: async () => undefined,
            get: async () => ({
                chainId: 10,
                blockNumber: 10,
                blockHash: HASH_B,
                parentHash: HASH_B,
                payload: {
                    block: {
                        chainId: 10,
                        number: 10,
                        hash: HASH_B,
                        parentHash: HASH_B,
                        timestamp: 1,
                        raw: {},
                    },
                    transactions: [],
                    logs: [],
                },
                fetchedAt: new Date(),
            }),
            deleteUpToBlock: async () => 0,
        },
        { insert: async () => undefined, deleteUpToBlock: async () => 0 },
        emptyCanonicalTransactionsRepository,
        emptyCanonicalEventsRepository,
        noopBlockJobsRepository,
        manager,
        leaderLock,
    );

    await expect(invokeTick(worker)).rejects.toThrow("Raw block parent hash mismatch");
});
