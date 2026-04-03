import { PostgresCanonicalEventsRepository } from "../../../src/repositories/postgres/index.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const TOPIC = asHash32("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
const DATA = asHexData("0x01");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("readFromSeq returns empty result when limit is zero", async () => {
    const query = jest.fn();
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 0n, 0)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
});

test("readFromSeq maps event rows", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            seq: "5",
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 0,
            transaction_hash: TX_HASH,
            log_index: 1,
            address: ADDRESS,
            topics: [TOPIC],
            data: DATA,
            raw: { ok: true },
        }],
        rowCount: 1,
    }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 4n, 5)).resolves.toMatchObject([
        {
            seq: 5n,
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            transactionHash: TX_HASH,
            address: ADDRESS,
            topics: [TOPIC],
            data: DATA,
        },
    ]);
});

test("maxSeq returns bigint value", async () => {
    const query = jest.fn(async () => ({ rows: [{ max_seq: "11" }], rowCount: 1 }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.maxSeq(1)).resolves.toBe(11n);
});

test("insertMany skips when logs list is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await repository.insertMany(1, 10, HASH_A, []);

    expect(query).not.toHaveBeenCalled();
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 5 }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(5);
});

test("deleteUpToBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(0);
});

test("insertMany writes one batch for small input", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await repository.insertMany(1, 10, HASH_A, [
        {
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            transactionIndex: 0,
            transactionHash: TX_HASH,
            index: 0,
            address: ADDRESS,
            topics: [TOPIC],
            data: DATA,
            raw: {},
        },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
});

test("readFromSeq throws when topics payload is invalid", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            seq: "5",
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 0,
            transaction_hash: TX_HASH,
            log_index: 1,
            address: ADDRESS,
            topics: "bad-topics-shape",
            data: DATA,
            raw: { ok: true },
        }],
        rowCount: 1,
    }));
    const repository = new PostgresCanonicalEventsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 4n, 5)).rejects.toThrow("invalid topics: expected array of hashes");
});
