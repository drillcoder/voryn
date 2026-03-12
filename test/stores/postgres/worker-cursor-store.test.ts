import { PostgresWorkerCursorStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("get returns existing worker cursor without bootstrap", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [{
            worker_name: "event-worker",
            chain_id: "1",
            stream_type: "event",
            last_seq: "42",
            updated_at: new Date("2026-03-12T10:00:00.000Z"),
        }],
        rowCount: 1,
    });
    const store = new PostgresWorkerCursorStore(createPool(query));

    const cursor = await store.get("event-worker", 1, "event");

    expect(cursor.workerName).toBe("event-worker");
    expect(cursor.chainId).toBe(1);
    expect(cursor.streamType).toBe("event");
    expect(cursor.lastSeq).toBe(42n);
    expect(cursor.updatedAt.toISOString()).toBe("2026-03-12T10:00:00.000Z");
    expect(query).toHaveBeenCalledTimes(1);
});

test("get bootstraps missing event cursor from current canonical_events seq", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ current_seq: "12" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                worker_name: "event-worker",
                chain_id: "5",
                stream_type: "event",
                last_seq: "12",
                updated_at: "2026-03-12T11:00:00.000Z",
            }],
            rowCount: 1,
        });
    const store = new PostgresWorkerCursorStore(createPool(query));

    const cursor = await store.get("event-worker", 5, "event");

    expect(cursor.lastSeq).toBe(12n);
    expect(cursor.updatedAt.toISOString()).toBe("2026-03-12T11:00:00.000Z");
    expect(query).toHaveBeenCalledTimes(4);

    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[1]?.[0]).toContain("FROM canonical_events");
    expect(calls[2]?.[1]).toEqual(["event-worker", 5, "event", 12n]);
});

test("get bootstraps missing tx cursor from current canonical_transactions seq", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ current_seq: "99" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{
                worker_name: "tx-worker",
                chain_id: "7",
                stream_type: "tx",
                last_seq: "99",
                updated_at: "2026-03-12T11:30:00.000Z",
            }],
            rowCount: 1,
        });
    const store = new PostgresWorkerCursorStore(createPool(query));

    const cursor = await store.get("tx-worker", 7, "tx");

    expect(cursor.lastSeq).toBe(99n);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[1]?.[0]).toContain("FROM canonical_transactions");
    expect(calls[2]?.[1]).toEqual(["tx-worker", 7, "tx", 99n]);
});

test("get throws when worker cursor is still missing after bootstrap insert", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ current_seq: "10" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new PostgresWorkerCursorStore(createPool(query));

    await expect(store.get("event-worker", 5, "event")).rejects.toThrow(
        "Failed to create worker cursor for worker \"event-worker\", chain 5, stream event"
    );
});

test("advance updates existing worker cursor", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 1,
    });
    const store = new PostgresWorkerCursorStore(createPool(query));

    await store.advance("event-worker", 1, "event", 77n);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual(["event-worker", 1, "event", 77n]);
});

test("advance throws when worker cursor row is missing", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
    });
    const store = new PostgresWorkerCursorStore(createPool(query));

    await expect(store.advance("event-worker", 1, "event", 77n)).rejects.toThrow(
        "Worker cursor is missing for worker \"event-worker\", chain 1, stream event. Call get() to bootstrap first"
    );
});
