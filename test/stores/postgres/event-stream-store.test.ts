import { PostgresEventStreamStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("readFromSeq returns mapped events ordered by seq", async () => {
    const payloadA = { kind: "a" };
    const payloadB = { kind: "b" };
    const query = jest.fn().mockResolvedValue({
        rows: [
            {
                seq: "11",
                chain_id: "1",
                block_number: "100",
                tx_index: 2,
                log_index: 0,
                payload: payloadA,
            },
            {
                seq: "12",
                chain_id: "1",
                block_number: "100",
                tx_index: 3,
                log_index: 1,
                payload: payloadB,
            },
        ],
        rowCount: 2,
    });
    const store = new PostgresEventStreamStore(createPool(query));

    const events = await store.readFromSeq(1, 10n, 100);

    expect(events).toEqual([
        {
            seq: 11n,
            chainId: 1,
            blockNumber: 100,
            txIndex: 2,
            logIndex: 0,
            payload: payloadA,
        },
        {
            seq: 12n,
            chainId: 1,
            blockNumber: 100,
            txIndex: 3,
            logIndex: 1,
            payload: payloadB,
        },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, 10n, 100]);
});

test("readFromSeq returns empty list when no rows found", async () => {
    const query = jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
    });
    const store = new PostgresEventStreamStore(createPool(query));

    const events = await store.readFromSeq(1, 99n, 50);

    expect(events).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
});

test("readFromSeq returns empty list and skips query when limit is non-positive", async () => {
    const query = jest.fn();
    const store = new PostgresEventStreamStore(createPool(query));

    const events = await store.readFromSeq(1, 99n, 0);

    expect(events).toEqual([]);
    expect(query).not.toHaveBeenCalled();
});
