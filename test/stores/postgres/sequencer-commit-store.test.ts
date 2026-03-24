import type { AddressHex, DataHex, HashHex } from "../../../src/types/chain.js";
import { PostgresSequencerCommitStore, type PgPool } from "../../../src/stores/postgres/index.js";

const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const HASH_C = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as HashHex;
const ADDRESS_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as AddressHex;
const ADDRESS_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as AddressHex;
const ADDRESS_C = "0xcccccccccccccccccccccccccccccccccccccccc" as AddressHex;

const createMockClient = (clientQuery: jest.Mock) => ({
    query: clientQuery as PgPool["query"],
    release: jest.fn(),
});

const createPool = (poolQuery: jest.Mock, clientQuery?: jest.Mock) => {
    const pool = {
        query: poolQuery as PgPool["query"],
        connect: jest.fn(),
    };

    if (clientQuery) {
        pool.connect.mockResolvedValueOnce(createMockClient(clientQuery));
    }

    return pool as unknown as PgPool;
};

test("commitNextBlock commits block data in a transaction and advances cursor", async () => {
    const blockRaw = { extra: "block-raw" };
    const txRaw = { extra: "tx-raw" };
    const logRaw = { extra: "log-raw" };
    const rawPayload = {
        block: {
            chainId: 1,
            number: 101,
            hash: HASH_B,
            parentHash: HASH_A,
            timestamp: 1710000000,
            raw: blockRaw,
        },
        transactions: [{
            chainId: 1,
            blockNumber: 101,
            blockHash: HASH_B,
            index: 0,
            hash: HASH_B,
            from: ADDRESS_A,
            to: ADDRESS_B,
            value: "1000",
            data: "0x1234" as DataHex,
            raw: txRaw,
        }],
        logs: [{
            chainId: 1,
            blockNumber: 101,
            blockHash: HASH_B,
            transactionIndex: 0,
            transactionHash: HASH_B,
            index: 0,
            address: ADDRESS_C,
            topics: [] as HashHex[],
            data: "0x1234" as DataHex,
            raw: logRaw,
        }],
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_blocks
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_transactions
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_events
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // chain_cursor
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // block_jobs
        .mockResolvedValueOnce({}); // COMMIT

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await store.commitNextBlock(1, 101);

    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(clientQuery).toHaveBeenCalledTimes(7);

    const clientCalls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(clientCalls[0]?.[0]).toBe("BEGIN");
    expect(clientCalls[1]?.[1]).toEqual([1, 101, HASH_B, HASH_A, 1710000000, blockRaw]);
    expect(clientCalls[2]?.[1]).toEqual([
        1,
        101,
        HASH_B,
        0,
        HASH_B,
        ADDRESS_A,
        ADDRESS_B,
        "1000",
        "0x1234",
        txRaw,
    ]);
    expect(clientCalls[3]?.[1]).toEqual([1, 101, HASH_B, 0, HASH_B, 0, ADDRESS_C, [], "0x1234", logRaw]);
    expect(clientCalls[4]?.[1]).toEqual([1, 101, HASH_B, HASH_A]);
    expect(clientCalls[5]?.[1]).toEqual([1, 101]);
    expect(clientCalls[6]?.[0]).toBe("COMMIT");
});

test("commitNextBlock throws when cursor for expected predecessor is missing", async () => {
    const poolQuery = jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Chain cursor not found for chain 1 at expected committed block 100"
    );
    expect(poolQuery).toHaveBeenCalledTimes(1);
});

test("commitNextBlock returns when raw block is missing", async () => {
    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await store.commitNextBlock(1, 101);

    expect(poolQuery).toHaveBeenCalledTimes(2);
});

test("commitNextBlock throws when parent hash mismatches cursor hash", async () => {
    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                block_hash: HASH_B,
                parent_hash: HASH_C,
                payload: {
                    block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_C, timestamp: 1, raw: {} },
                    transactions: [],
                    logs: [],
                },
            }],
            rowCount: 1,
        });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Raw block parent hash mismatch for chain 1 block 101"
    );
    expect(poolQuery).toHaveBeenCalledTimes(2);
});

test("commitNextBlock throws when raw block payload is invalid", async () => {
    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: "not-an-object" }],
            rowCount: 1,
        });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Invalid raw block payload for chain 1 block 101: expected object"
    );
});

test("commitNextBlock throws when transaction item is invalid", async () => {
    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                block_hash: HASH_B,
                parent_hash: HASH_A,
                payload: {
                    block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
                    transactions: [{ index: "not-a-number" }],
                    logs: [],
                },
            }],
            rowCount: 1,
        });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Invalid chain 1 block 101 transactions[0].value: expected string"
    );
});

test("commitNextBlock throws when log item is invalid", async () => {
    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                block_hash: HASH_B,
                parent_hash: HASH_A,
                payload: {
                    block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
                    transactions: [],
                    logs: [{ transactionIndex: 0 }],
                },
            }],
            rowCount: 1,
        });
    const store = new PostgresSequencerCommitStore(createPool(poolQuery));

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Invalid chain 1 block 101 logs[0].topics: expected array"
    );
});

test("commitNextBlock rolls back transaction on insert failure", async () => {
    const rawPayload = {
        block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
        transactions: [],
        logs: [],
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error("insert failed")); // canonical_blocks

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow("insert failed");

    const clientCalls = clientQuery.mock.calls as Array<[string]>;
    expect(clientCalls[0]?.[0]).toBe("BEGIN");
    expect(clientCalls[2]?.[0]).toBe("ROLLBACK");
});

test("commitNextBlock inserts multiple transactions and logs in batch queries", async () => {
    const txRawA = { tx: "a" };
    const txRawB = { tx: "b" };
    const logRawA = { log: "a" };
    const logRawB = { log: "b" };
    const rawPayload = {
        block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
        transactions: [
            {
                chainId: 1,
                blockNumber: 101,
                blockHash: HASH_B,
                index: 0,
                hash: HASH_B,
                from: ADDRESS_A,
                to: ADDRESS_B,
                value: "1",
                data: "0x12" as DataHex,
                raw: txRawA,
            },
            {
                chainId: 1,
                blockNumber: 101,
                blockHash: HASH_B,
                index: 1,
                hash: HASH_C,
                from: ADDRESS_A,
                to: null,
                value: "2",
                data: "0x34" as DataHex,
                raw: txRawB,
            },
        ],
        logs: [
            {
                chainId: 1,
                blockNumber: 101,
                blockHash: HASH_B,
                transactionIndex: 0,
                transactionHash: HASH_B,
                index: 0,
                address: ADDRESS_C,
                topics: [] as HashHex[],
                data: "0xab" as DataHex,
                raw: logRawA,
            },
            {
                chainId: 1,
                blockNumber: 101,
                blockHash: HASH_B,
                transactionIndex: 1,
                transactionHash: HASH_C,
                index: 1,
                address: ADDRESS_C,
                topics: [HASH_A] as HashHex[],
                data: "0xcd" as DataHex,
                raw: logRawB,
            },
        ],
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_blocks
        .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // canonical_transactions batch
        .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // canonical_events batch
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // chain_cursor
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // block_jobs
        .mockResolvedValueOnce({}); // COMMIT

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await store.commitNextBlock(1, 101);

    expect(clientQuery).toHaveBeenCalledTimes(7);
    const clientCalls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(clientCalls[2]?.[1]).toEqual([
        1, 101, HASH_B, 0, HASH_B, ADDRESS_A, ADDRESS_B, "1", "0x12", txRawA,
        1, 101, HASH_B, 1, HASH_C, ADDRESS_A, null, "2", "0x34", txRawB,
    ]);
    expect(clientCalls[3]?.[1]).toEqual([
        1, 101, HASH_B, 0, HASH_B, 0, ADDRESS_C, [], "0xab", logRawA,
        1, 101, HASH_B, 1, HASH_C, 1, ADDRESS_C, [HASH_A], "0xcd", logRawB,
    ]);
});

test("commitNextBlock rolls back when chain cursor update affects zero rows", async () => {
    const rawPayload = {
        block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
        transactions: [],
        logs: [],
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_blocks
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // canonical_transactions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // canonical_events
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // chain_cursor

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Failed to advance chain cursor for chain 1 to block 101"
    );

    expect(clientQuery).toHaveBeenCalledTimes(4);
    const clientCalls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(clientCalls[0]?.[0]).toBe("BEGIN");
    expect(clientCalls[3]?.[0]).toBe("ROLLBACK");
});

test("commitNextBlock rolls back when block job update affects zero rows", async () => {
    const rawPayload = {
        block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
        transactions: [],
        logs: [],
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_blocks
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // chain_cursor
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // block_jobs

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await expect(store.commitNextBlock(1, 101)).rejects.toThrow(
        "Failed to mark block job as committed for chain 1 block 101"
    );

    expect(clientQuery).toHaveBeenCalledTimes(5);
    const clientCalls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(clientCalls[0]?.[0]).toBe("BEGIN");
    expect(clientCalls[4]?.[0]).toBe("ROLLBACK");
});

test("commitNextBlock splits event inserts into batches when logs exceed parameter limit", async () => {
    const logs = Array.from({ length: 7000 }, (_, index) => ({
        chainId: 1,
        blockNumber: 101,
        blockHash: HASH_B,
        transactionIndex: index,
        transactionHash: HASH_B,
        index,
        address: ADDRESS_C,
        topics: [] as HashHex[],
        data: "0xab" as DataHex,
        raw: { log: index },
    }));

    const rawPayload = {
        block: { chainId: 1, number: 101, hash: HASH_B, parentHash: HASH_A, timestamp: 1, raw: {} },
        transactions: [],
        logs,
    };

    const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ last_committed_hash: HASH_A }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ block_hash: HASH_B, parent_hash: HASH_A, payload: rawPayload }],
            rowCount: 1,
        });

    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // canonical_blocks
        .mockResolvedValueOnce({ rows: [], rowCount: 6000 }) // canonical_events batch 1
        .mockResolvedValueOnce({ rows: [], rowCount: 1000 }) // canonical_events batch 2
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // chain_cursor
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // block_jobs
        .mockResolvedValueOnce({}); // COMMIT

    const pool = createPool(poolQuery, clientQuery);
    const store = new PostgresSequencerCommitStore(pool);

    await store.commitNextBlock(1, 101);

    expect(clientQuery).toHaveBeenCalledTimes(7);
    const clientCalls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(clientCalls[2]?.[1]).toHaveLength(60000);
    expect(clientCalls[3]?.[1]).toHaveLength(10000);
});
