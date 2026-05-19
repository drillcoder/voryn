import { PostgresEventsRepository } from "../../../../src/repositories/postgres/events-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asAddress, asHash32, asHexData } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS = asAddress("0x1111111111111111111111111111111111111111");
const TOPIC = asHash32("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
const DATA = asHexData("0x01");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("listAfterPosition returns empty result when limit is zero", async () => {
    const query = jest.fn();
    const repository = new PostgresEventsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 0, 0)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
});

test("listAfterPosition maps event rows", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 0,
            transaction_hash: TX_HASH,
            log_index: 1,
            address: ADDRESS,
            topics: [TOPIC],
            data: DATA,
        }],
        rowCount: 1,
    }));
    const repository = new PostgresEventsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 0, 5)).resolves.toMatchObject([
        {
            chainId: 1,
            blockNumber: 10,
            blockHash: HASH_A,
            transactionIndex: 0,
            transactionHash: TX_HASH,
            index: 1,
            address: ADDRESS,
            topics: [TOPIC],
            data: DATA,
        },
    ]);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number <= $2");
    expect(calls[0]?.[0]).toContain("(block_number, transaction_index, log_index) > ($3, $4, $5)");
    expect(calls[0]?.[1]).toEqual([1, 10, 9, 0, 0, 5]);
});

test("insertMany skips when logs list is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresEventsRepository(createExecutor(query));

    await repository.insertMany([]);

    expect(query).not.toHaveBeenCalled();
});

test("insertMany writes one batch for small input", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresEventsRepository(createExecutor(query));

    await repository.insertMany([
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
        },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("INSERT INTO events");
    expect(calls[0]?.[1]).toEqual([1, 10, HASH_A, 0, TX_HASH, 0, ADDRESS, [TOPIC], DATA]);
});

test("listAfterPosition throws when topics payload is invalid", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            transaction_index: 0,
            transaction_hash: TX_HASH,
            log_index: 1,
            address: ADDRESS,
            topics: "bad-topics-shape",
            data: DATA,
        }],
        rowCount: 1,
    }));
    const repository = new PostgresEventsRepository(createExecutor(query));

    await expect(repository.listAfterPosition(1, 10, 9, 0, 0, 5)).rejects.toThrow(
        "invalid topics: expected array of hashes"
    );
});

test("deleteAtOrBeforeBlockNumber returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 5 }));
    const repository = new PostgresEventsRepository(createExecutor(query));

    await expect(repository.deleteAtOrBeforeBlockNumber(1, 10)).resolves.toBe(5);
});

test("deleteAfterBlockNumber returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresEventsRepository(createExecutor(query));

    await expect(repository.deleteAfterBlockNumber(1, 10)).resolves.toBe(0);
});
