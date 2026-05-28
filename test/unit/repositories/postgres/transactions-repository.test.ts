import { PostgresTransactionsRepository } from "../../../../src/repositories/postgres/transactions-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asAddress, asHash32, asHexData } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const FROM = asAddress("0x1111111111111111111111111111111111111111");
const DATA = asHexData("0x01");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("listAfterPosition returns empty result when limit is zero", async () => {
    const query = jest.fn();
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 0)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
});

test("listAfterPosition maps transaction rows", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 1,
            transaction_hash: TX_HASH,
            from_address: FROM,
            to_address: null,
            value: "123",
            data: DATA,
        }],
        rowCount: 1,
    }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 10)).resolves.toMatchObject([
        {
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            index: 1,
            hash: TX_HASH,
            from: FROM,
            to: null,
            value: "123",
            data: DATA,
        },
    ]);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number <= $2");
    expect(calls[0]?.[0]).toContain("(block_number, transaction_index) > ($3, $4)");
    expect(calls[0]?.[1]).toEqual([1, 10, 9, 0, 10]);
});

test("listAfterPosition maps transaction recipient address", async () => {
    const toAddress = asAddress("0x2222222222222222222222222222222222222222");
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 1,
            transaction_hash: TX_HASH,
            from_address: FROM,
            to_address: toAddress,
            value: "123",
            data: DATA,
        }],
        rowCount: 1,
    }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 10)).resolves.toEqual([
        {
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            index: 1,
            hash: TX_HASH,
            from: FROM,
            to: toAddress,
            value: "123",
            data: DATA,
        },
    ]);
});

test("insertMany skips when transaction list is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await repository.insertMany([]);

    expect(query).not.toHaveBeenCalled();
});

test("insertMany writes one batch for small input", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await repository.insertMany([
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
        },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("INSERT INTO transactions");
    expect(calls[0]?.[1]).toEqual([1, 10, HASH_A, 0, TX_HASH, FROM, null, "1", DATA]);
});

test("deleteBlockNumberRange deletes transactions in block number range", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteBlockNumberRange(1, 10, 12)).resolves.toBe(2);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number BETWEEN $2 AND $3");
    expect(calls[0]?.[1]).toEqual([1, 10, 12]);
});

test("deleteBlockNumberRange skips query when range is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteBlockNumberRange(1, 12, 10)).resolves.toBe(0);

    expect(query).not.toHaveBeenCalled();
});

test("deleteBlockNumberRange returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteBlockNumberRange(1, 10, 12)).resolves.toBe(0);
});

test("deleteByBlockNumber deletes transactions for one block", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteByBlockNumber(1, 10)).resolves.toBe(2);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number = $2");
    expect(calls[0]?.[1]).toEqual([1, 10]);
});

test("deleteByBlockNumber returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteByBlockNumber(1, 10)).resolves.toBe(0);
});

test("deleteAfterBlockNumber deletes transactions after block number", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 4 }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteAfterBlockNumber(1, 10)).resolves.toBe(4);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number > $2");
    expect(calls[0]?.[1]).toEqual([1, 10]);
});

test("deleteAfterBlockNumber returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresTransactionsRepository(createExecutor(query));

    await expect(repository.deleteAfterBlockNumber(1, 10)).resolves.toBe(0);
});
