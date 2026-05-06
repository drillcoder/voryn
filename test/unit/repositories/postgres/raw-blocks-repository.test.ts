import { PostgresRawBlocksRepository } from "../../../../src/repositories/postgres/raw-blocks-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("get returns null when raw block is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 100)).resolves.toBeNull();
});

test("get maps raw block row", async () => {
    const payload = {
        block: {
            chainId: 1,
            number: 100,
            hash: HASH_A,
            parentHash: HASH_B,
            timestamp: 1,
            raw: {},
        },
        transactions: [],
        logs: [],
    };
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "100",
            block_hash: HASH_A,
            parent_hash: HASH_B,
            payload,
            fetched_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 100)).resolves.toMatchObject({
        chainId: 1,
        blockNumber: 100,
        blockHash: HASH_A,
        parentHash: HASH_B,
        payload,
    });
});

test("save stores raw block payload", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));
    const payload = {
        block: { chainId: 1, number: 100, hash: HASH_A, parentHash: HASH_B, timestamp: 1, raw: {} },
        transactions: [],
        logs: [],
    };

    await repository.save({
        chainId: 1,
        blockNumber: 100,
        blockHash: HASH_A,
        parentHash: HASH_B,
        payload,
        fetchedAt: new Date("2026-03-30T10:00:00.000Z"),
    });

    expect(query).toHaveBeenCalledTimes(1);
});

test("getMetrics maps fetched block boundary and fetch time", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            max_fetched_block: "123",
            last_fetched_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.getMetrics(1)).resolves.toEqual({
        maxFetchedBlock: 123,
        lastFetchedAt: new Date("2026-03-30T10:00:00.000Z"),
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("MAX(block_number)");
    expect(calls[0]?.[1]).toEqual([1]);
});

test("getMetrics maps empty raw block table", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            max_fetched_block: null,
            last_fetched_at: null,
        }],
        rowCount: 1,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.getMetrics(1)).resolves.toEqual({
        maxFetchedBlock: null,
        lastFetchedAt: null,
    });
});

test("findFirstMissingInRange skips query when range is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.findFirstMissingInRange(1, 10, 9)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
});

test("findFirstMissingInRange returns first gap", async () => {
    const query = jest.fn(async () => ({
        rows: [{ block_number: "42" }],
        rowCount: 1,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.findFirstMissingInRange(1, 40, 45)).resolves.toBe(42);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("generate_series");
    expect(calls[0]?.[1]).toEqual([1, 40, 45]);
});

test("findFirstMissingInRange returns null when range is contiguous", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.findFirstMissingInRange(1, 40, 45)).resolves.toBeNull();
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 7 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(7);
});

test("deleteAfterBlock deletes rows after block number", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 3 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 100)).resolves.toBe(3);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number > $2");
    expect(calls[0]?.[1]).toEqual([1, 100]);
});

test("deleteAfterBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 100)).resolves.toBe(0);
});
