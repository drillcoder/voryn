import type { HashHex } from "../../../src/types/chain.js";
import { PostgresChainCursorStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("get returns existing chain cursor without bootstrap", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [{
            chain_id: 1,
            last_enqueued_block: "42",
            last_committed_block: "41",
            last_committed_hash: HASH_A,
            updated_at: new Date("2026-03-10T10:00:00.000Z"),
        }],
        rowCount: 1,
    });
    const bootstrap = jest.fn();
    const store = new PostgresChainCursorStore(createPool(query), bootstrap);

    const cursor = await store.get(1);

    expect(cursor.chainId).toBe(1);
    expect(cursor.lastEnqueuedBlock).toBe(42);
    expect(cursor.lastCommittedBlock).toBe(41);
    expect(cursor.lastCommittedHash).toBe(HASH_A);
    expect(cursor.updatedAt.toISOString()).toBe("2026-03-10T10:00:00.000Z");
    expect(bootstrap).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
});

test("get bootstraps missing chain cursor and reads created row", async () => {
    const bootstrap = jest.fn(async () => ({
        lastEnqueuedBlock: 100,
        lastCommittedBlock: 100,
        lastCommittedHash: HASH_B,
    }));
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                chain_id: 5,
                last_enqueued_block: "100",
                last_committed_block: "100",
                last_committed_hash: HASH_B,
                updated_at: "2026-03-10T12:00:00.000Z",
            }],
            rowCount: 1,
        });
    const store = new PostgresChainCursorStore(createPool(query), bootstrap);

    const cursor = await store.get(5);

    expect(cursor.chainId).toBe(5);
    expect(cursor.lastEnqueuedBlock).toBe(100);
    expect(cursor.lastCommittedBlock).toBe(100);
    expect(cursor.lastCommittedHash).toBe(HASH_B);
    expect(cursor.updatedAt.toISOString()).toBe("2026-03-10T12:00:00.000Z");
    expect(bootstrap).toHaveBeenCalledWith(5);
    expect(query).toHaveBeenCalledTimes(3);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[1]?.[1]).toEqual([5, 100, 100, HASH_B]);
});

test("get throws when cursor is still missing after bootstrap insert", async () => {
    const bootstrap = jest.fn(async () => ({
        lastEnqueuedBlock: 100,
        lastCommittedBlock: 100,
        lastCommittedHash: HASH_B,
    }));
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new PostgresChainCursorStore(createPool(query), bootstrap);

    await expect(store.get(5)).rejects.toThrow("Failed to create chain cursor for chain 5");
    expect(bootstrap).toHaveBeenCalledWith(5);
    expect(query).toHaveBeenCalledTimes(3);
});

test("setLastEnqueued updates existing row without bootstrap", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 1,
    });
    const bootstrap = jest.fn();
    const store = new PostgresChainCursorStore(createPool(query), bootstrap);

    await store.setLastEnqueued(1, 77);

    expect(query).toHaveBeenCalledTimes(1);
    expect(bootstrap).not.toHaveBeenCalled();
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, 77]);
});

test("setLastEnqueued throws when cursor row is missing", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
    });
    const bootstrap = jest.fn();
    const store = new PostgresChainCursorStore(createPool(query), bootstrap);

    await expect(store.setLastEnqueued(9, 80)).rejects.toThrow(
        "Chain cursor for chain 9 is missing. Call get() to bootstrap first"
    );
    expect(query).toHaveBeenCalledTimes(1);
});
