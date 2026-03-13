import { PostgresRetentionStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("purgeRawBlocks deletes rows older than cutoff and returns rowCount", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 7,
    });
    const store = new PostgresRetentionStore(createPool(query));
    const cutoff = new Date("2026-03-13T10:00:00.000Z");

    const deleted = await store.purgeRawBlocks(1, cutoff);

    expect(deleted).toBe(7);
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("DELETE FROM raw_blocks");
    expect(calls[0]?.[1]).toEqual([1, cutoff]);
});

test("purgeRawBlocks returns zero when rowCount is null", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: null,
    });
    const store = new PostgresRetentionStore(createPool(query));

    const deleted = await store.purgeRawBlocks(1, new Date("2026-03-13T10:00:00.000Z"));

    expect(deleted).toBe(0);
});

test("purgeCanonical returns number of deleted canonical blocks", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [{ target_count: "3" }],
        rowCount: 1,
    });
    const store = new PostgresRetentionStore(createPool(query));
    const cutoff = new Date("2026-03-13T12:34:56.999Z");

    const deleted = await store.purgeCanonical(5, cutoff);

    expect(deleted).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("WITH target_blocks AS");
    expect(calls[0]?.[1]).toEqual([5, 1773405296]);
});

test("purgeCanonical returns zero when query returned no rows", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
    });
    const store = new PostgresRetentionStore(createPool(query));

    const deleted = await store.purgeCanonical(5, new Date("2026-03-13T00:00:00.000Z"));

    expect(deleted).toBe(0);
});
