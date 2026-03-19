import { PostgresEventStreamStore, type PgPool, type PgQueryExecutor } from "../../../src/stores/postgres/index.js";
import type { AddressHex, DataHex, HashHex } from "../../../src/types/chain.js";

const BLOCK_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as HashHex;
const TX_HASH_A = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as HashHex;
const TX_HASH_B = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as HashHex;
const ADDRESS = "0x1111111111111111111111111111111111111111" as AddressHex;
const TOPIC_A = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as HashHex;
const TOPIC_B = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as HashHex;
const DATA_A = "0x01" as DataHex;
const DATA_B = "0x0203" as DataHex;

const createPool = (query: jest.Mock): PgQueryExecutor => ({ query: query as PgPool["query"] });

test("readFromSeq returns mapped events ordered by seq", async () => {
    const rawA = { kind: "a" };
    const rawB = { kind: "b" };
    const query = jest.fn().mockResolvedValue({
        rows: [
            {
                seq: "11",
                chain_id: 1,
                block_number: "100",
                block_hash: BLOCK_HASH,
                transaction_index: 2,
                transaction_hash: TX_HASH_A,
                log_index: 0,
                address: ADDRESS,
                topics: [TOPIC_A],
                data: DATA_A,
                raw: rawA,
            },
            {
                seq: "12",
                chain_id: 1,
                block_number: "100",
                block_hash: BLOCK_HASH,
                transaction_index: 3,
                transaction_hash: TX_HASH_B,
                log_index: 1,
                address: ADDRESS,
                topics: [TOPIC_A, TOPIC_B],
                data: DATA_B,
                raw: rawB,
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
            blockHash: BLOCK_HASH,
            transactionIndex: 2,
            transactionHash: TX_HASH_A,
            index: 0,
            address: ADDRESS,
            topics: [TOPIC_A],
            data: DATA_A,
            raw: rawA,
        },
        {
            seq: 12n,
            chainId: 1,
            blockNumber: 100,
            blockHash: BLOCK_HASH,
            transactionIndex: 3,
            transactionHash: TX_HASH_B,
            index: 1,
            address: ADDRESS,
            topics: [TOPIC_A, TOPIC_B],
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
