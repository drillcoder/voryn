import { PostgresRetentionStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("purge deletes data in all retention tables using depth from committed block", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [{
            deleted_block_jobs_count: "5",
            deleted_raw_blocks_count: "4",
            deleted_canonical_events_count: "3",
            deleted_canonical_transactions_count: "2",
            deleted_canonical_blocks_count: "1",
        }],
        rowCount: 1,
    });
    const store = new PostgresRetentionStore(createPool(query));

    const deleted = await store.purge(1, 6500);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("last_committed_block - $2::BIGINT");
    expect(calls[0]?.[0]).toContain("DELETE FROM block_jobs");
    expect(calls[0]?.[0]).toContain("status = 'committed'");
    expect(calls[0]?.[0]).toContain("DELETE FROM raw_blocks");
    expect(calls[0]?.[0]).toContain("DELETE FROM canonical_events");
    expect(calls[0]?.[0]).toContain("DELETE FROM canonical_transactions");
    expect(calls[0]?.[0]).toContain("DELETE FROM canonical_blocks");
    expect(calls[0]?.[0]).toContain("AS deleted_block_jobs_count");
    expect(calls[0]?.[1]).toEqual([1, 6500]);
    expect(deleted).toEqual({
        deletedBlockJobs: 5,
        deletedRawBlocks: 4,
        deletedCanonicalEvents: 3,
        deletedCanonicalTransactions: 2,
        deletedCanonicalBlocks: 1,
    });
});

test("purge still executes when depth is zero", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [{
            deleted_block_jobs_count: "0",
            deleted_raw_blocks_count: "0",
            deleted_canonical_events_count: "0",
            deleted_canonical_transactions_count: "0",
            deleted_canonical_blocks_count: "0",
        }],
        rowCount: 1,
    });
    const store = new PostgresRetentionStore(createPool(query));

    const deleted = await store.purge(1, 0);

    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, 0]);
    expect(deleted).toEqual({
        deletedBlockJobs: 0,
        deletedRawBlocks: 0,
        deletedCanonicalEvents: 0,
        deletedCanonicalTransactions: 0,
        deletedCanonicalBlocks: 0,
    });
});
