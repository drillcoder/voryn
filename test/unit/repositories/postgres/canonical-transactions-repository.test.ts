import {
    PostgresCanonicalTransactionsRepository
} from "../../../../src/repositories/postgres/canonical-transactions-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asAddress, asHash32, asHexData } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const FROM = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("readFromSeq returns empty result when limit is zero", async () => {
    const query = jest.fn();
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 0n, 0)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
});

test("readFromSeq maps transaction rows", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            seq: "2",
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 1,
            transaction_hash: TX_HASH,
            from_address: FROM,
            to_address: null,
            value: "123",
            data: DATA,
            raw: { ok: true },
        }],
        rowCount: 1,
    }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 1n, 10)).resolves.toMatchObject([
        {
            seq: 2n,
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            hash: TX_HASH,
            from: FROM,
            to: null,
            value: "123",
            data: DATA,
        },
    ]);
});

test("readFromSeq maps recipient address", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            seq: "2",
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 1,
            transaction_hash: TX_HASH,
            from_address: FROM,
            to_address: FROM,
            value: "123",
            data: DATA,
            raw: { ok: true },
        }],
        rowCount: 1,
    }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.readFromSeq(1, 1n, 10)).resolves.toMatchObject([
        {
            to: FROM,
        },
    ]);
});

test("maxSeq returns bigint value", async () => {
    const query = jest.fn(async () => ({ rows: [{ max_seq: "9" }], rowCount: 1 }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.maxSeq(1)).resolves.toBe(9n);
});

test("insertMany skips when transaction list is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await repository.insertMany(1, 10, HASH_A, []);

    expect(query).not.toHaveBeenCalled();
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 4 }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(4);
});

test("deleteUpToBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(0);
});

test("deleteAfterBlock deletes transactions after block number", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 4 }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 10)).resolves.toBe(4);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number > $2");
    expect(calls[0]?.[1]).toEqual([1, 10]);
});

test("deleteAfterBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 10)).resolves.toBe(0);
});

test("insertMany writes one batch for small input", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresCanonicalTransactionsRepository(createExecutor(query));

    await repository.insertMany(1, 10, HASH_A, [
        {
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            index: 0,
            hash: TX_HASH,
            from: FROM,
            to: null,
            value: "1",
            data: DATA,
            raw: {},
        },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
});
