import { PostgresTransactionStreamStore } from "../../../src/stores/postgres/index.js";
import type { PgPool, PgQueryExecutor } from "../../../src/stores/postgres/index.js";
import type { HashHex } from "../../../src/types/chain.js";

const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("readFromSeq returns mapped transactions ordered by seq", async () => {
    const payloadA = { kind: "a" };
    const payloadB = { kind: "b" };
    const query = jest.fn().mockResolvedValue({
        rows: [
            {
                seq: "11",
                chain_id: 1,
                block_number: "100",
                tx_index: 2,
                tx_hash: HASH_A,
                payload: payloadA,
            },
            {
                seq: "12",
                chain_id: 1,
                block_number: "100",
                tx_index: 3,
                tx_hash: HASH_B,
                payload: payloadB,
            },
        ],
        rowCount: 2,
    });
    const store = new PostgresTransactionStreamStore(createPool(query));

    const transactions = await store.readFromSeq(1, 10n, 100);

    expect(transactions).toEqual([
        {
            seq: 11n,
            chainId: 1,
            blockNumber: 100,
            txIndex: 2,
            txHash: HASH_A,
            payload: payloadA,
        },
        {
            seq: 12n,
            chainId: 1,
            blockNumber: 100,
            txIndex: 3,
            txHash: HASH_B,
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
    const store = new PostgresTransactionStreamStore(createPool(query));

    const transactions = await store.readFromSeq(1, 99n, 50);

    expect(transactions).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
});

test("readFromSeq returns empty list and skips query when limit is non-positive", async () => {
    const query = jest.fn();
    const store = new PostgresTransactionStreamStore(createPool(query));

    const transactions = await store.readFromSeq(1, 99n, 0);

    expect(transactions).toEqual([]);
    expect(query).not.toHaveBeenCalled();
});
