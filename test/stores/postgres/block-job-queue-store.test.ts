import { PostgresBlockJobQueueStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("enqueueRange inserts pending jobs for inclusive range", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 3 });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    await store.enqueueRange(1, 100, 102);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("FROM generate_series($2::BIGINT, $3::BIGINT)");
    expect(calls[0]?.[1]).toEqual([1, 100, 102]);
});

test("enqueueRange does nothing when fromBlock is greater than toBlock", async () => {
    const query = jest.fn();
    const store = new PostgresBlockJobQueueStore(createPool(query));

    await store.enqueueRange(1, 103, 102);

    expect(query).not.toHaveBeenCalled();
});

test("claimForFetch returns null when no eligible job exists", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    const claimed = await store.claimForFetch(1, "worker-a");

    expect(claimed).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
});

test("claimForFetch claims and maps block job", async () => {
    const now = "2026-03-19T10:00:00.000Z";
    const query = jest.fn().mockResolvedValue({
        rows: [{
            chain_id: 1,
            block_number: "101",
            status: "fetching",
            attempts: 2,
            next_retry_at: null,
            error: null,
            claimed_at: now,
            updated_at: now,
        }],
        rowCount: 1,
    });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    const claimed = await store.claimForFetch(1, "worker-a");

    expect(claimed).toEqual({
        chainId: 1,
        blockNumber: 101,
        status: "fetching",
        attempts: 2,
        nextRetryAt: null,
        error: null,
        claimedAt: new Date(now),
        updatedAt: new Date(now),
    });
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, "worker-a"]);
});

test("markFetched updates fetching job", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    await store.markFetched(1, 101);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("SET status = 'fetched'");
    expect(calls[0]?.[1]).toEqual([1, 101]);
});

test("markFetched throws when job is not in fetching state", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    await expect(store.markFetched(1, 101)).rejects.toThrow(
        "Cannot mark block job as fetched for chain 1 block 101"
    );
});

test("markFetchFailed updates fetching job with retry info", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const store = new PostgresBlockJobQueueStore(createPool(query));
    const retryAt = new Date("2026-03-19T10:05:00.000Z");

    await store.markFetchFailed(1, 101, "rpc timeout", retryAt);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("SET status = 'failed'");
    expect(calls[0]?.[1]).toEqual([1, 101, "rpc timeout", retryAt]);
});

test("markFetchFailed throws when job is not in fetching state", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const store = new PostgresBlockJobQueueStore(createPool(query));

    await expect(store.markFetchFailed(1, 101, "rpc timeout", null)).rejects.toThrow(
        "Cannot mark block job as failed for chain 1 block 101"
    );
});
