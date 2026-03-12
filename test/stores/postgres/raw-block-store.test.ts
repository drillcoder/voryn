import { PostgresRawBlockStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";
import type { FetchedBlock, HashHex } from "../../../src/types/chain.js";

const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const HASH_C = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as HashHex;

const FETCHED_BLOCK: FetchedBlock = {
    block: {
        chainId: 1,
        number: 42,
        hash: HASH_A,
        parentHash: HASH_B,
        timestamp: 1710000000,
    },
    transactions: [],
    logs: [],
};

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("save upserts raw block", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const store = new PostgresRawBlockStore(createPool(query));
    const fetchedAt = new Date("2026-03-13T10:00:00.000Z");

    await store.save({
        chainId: 1,
        blockNumber: 42,
        blockHash: HASH_A,
        parentHash: HASH_B,
        payload: FETCHED_BLOCK,
        fetchedAt,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("ON CONFLICT (chain_id, block_number) DO UPDATE");
    expect(calls[0]?.[1]).toEqual([1, 42, HASH_A, HASH_B, FETCHED_BLOCK, fetchedAt]);
});

test("get returns mapped raw block when row exists", async () => {
    const fetchedAt = "2026-03-13T11:00:00.000Z";
    const query = jest.fn().mockResolvedValue({
        rows: [{
            chain_id: "5",
            block_number: "100",
            block_hash: HASH_B,
            parent_hash: HASH_C,
            payload: FETCHED_BLOCK,
            fetched_at: fetchedAt,
        }],
        rowCount: 1,
    });
    const store = new PostgresRawBlockStore(createPool(query));

    const result = await store.get(5, 100);

    expect(result).toEqual({
        chainId: 5,
        blockNumber: 100,
        blockHash: HASH_B,
        parentHash: HASH_C,
        payload: FETCHED_BLOCK,
        fetchedAt: new Date(fetchedAt),
    });
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([5, 100]);
});

test("get returns null when row is missing", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
    });
    const store = new PostgresRawBlockStore(createPool(query));

    const result = await store.get(9, 999);

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
});
