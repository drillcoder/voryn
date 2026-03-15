import { PostgresTransactionStreamStore } from "../../../src/stores/postgres/index.js";
import type { PgPool, PgQueryExecutor } from "../../../src/stores/postgres/index.js";
import type { AddressHex, DataHex, HashHex } from "../../../src/types/chain.js";

const BLOCK_HASH = "0x9999999999999999999999999999999999999999999999999999999999999999" as HashHex;
const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const FROM_A = "0x1111111111111111111111111111111111111111" as AddressHex;
const FROM_B = "0x2222222222222222222222222222222222222222" as AddressHex;
const TO_A = "0x3333333333333333333333333333333333333333" as AddressHex;
const DATA_A = "0x1234" as DataHex;
const DATA_B = "0x56" as DataHex;

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("readFromSeq returns mapped transactions ordered by seq", async () => {
    const rawA = { kind: "a" };
    const rawB = { kind: "b" };
    const query = jest.fn().mockResolvedValue({
        rows: [
            {
                seq: "11",
                chain_id: 1,
                block_number: "100",
                block_hash: BLOCK_HASH,
                tx_index: 2,
                tx_hash: HASH_A,
                from_address: FROM_A,
                to_address: TO_A,
                value: "1000",
                data: DATA_A,
                raw: rawA,
            },
            {
                seq: "12",
                chain_id: 1,
                block_number: "100",
                block_hash: BLOCK_HASH,
                tx_index: 3,
                tx_hash: HASH_B,
                from_address: FROM_B,
                to_address: null,
                value: "2000",
                data: DATA_B,
                raw: rawB,
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
            blockHash: BLOCK_HASH,
            index: 2,
            hash: HASH_A,
            from: FROM_A,
            to: TO_A,
            value: "1000",
            data: DATA_A,
            raw: rawA,
        },
        {
            seq: 12n,
            chainId: 1,
            blockNumber: 100,
            blockHash: BLOCK_HASH,
            index: 3,
            hash: HASH_B,
            from: FROM_B,
            to: null,
            value: "2000",
            data: DATA_B,
            raw: rawB,
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
