import { PostgresBlocksRepository } from "../../../../src/repositories/postgres/blocks-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("get returns null when block is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 100)).resolves.toBeNull();
});

test("get maps block row", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "100",
            block_hash: HASH_A,
            parent_hash: HASH_B,
            block_timestamp: "1711792800",
            fetched_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 100)).resolves.toEqual({
        chainId: 1,
        blockNumber: 100,
        blockHash: HASH_A,
        parentHash: HASH_B,
        blockTimestamp: 1711792800,
        fetchedAt: new Date("2026-03-30T10:00:00.000Z"),
    });
});

test("save inserts block data", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresBlocksRepository(createExecutor(query));
    const fetchedAt = new Date("2026-03-30T10:00:00.000Z");

    await repository.insert({
        chainId: 1,
        blockNumber: 100,
        blockHash: HASH_A,
        parentHash: HASH_B,
        blockTimestamp: 1711792800,
        fetchedAt,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("INSERT INTO blocks");
    expect(calls[0]?.[1]).toEqual([1, 100, HASH_A, HASH_B, 1711792800, fetchedAt]);
});

test("getProgress maps latest block and fetch time", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            max_fetched_block: "123",
            max_fetched_block_timestamp: "1711792800",
            last_fetched_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.getProgress(1)).resolves.toEqual({
        block: 123,
        blockTimestamp: 1711792800,
        updatedAt: new Date("2026-03-30T10:00:00.000Z"),
    });
});

test("getProgress returns null when blocks table is empty", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.getProgress(1)).resolves.toBeNull();
});

test("getProgress throws when progress row is malformed", async () => {
    const query = jest.fn()
        .mockResolvedValueOnce({
            rows: [{
                max_fetched_block: null,
                max_fetched_block_timestamp: null,
                last_fetched_at: "2026-03-30T10:00:00.000Z",
            }],
            rowCount: 1,
        })
        .mockResolvedValueOnce({
            rows: [{
                max_fetched_block: "123",
                max_fetched_block_timestamp: null,
                last_fetched_at: "2026-03-30T10:00:00.000Z",
            }],
            rowCount: 1,
        })
        .mockResolvedValueOnce({
            rows: [{
                max_fetched_block: "123",
                max_fetched_block_timestamp: "1711792800",
                last_fetched_at: null,
            }],
            rowCount: 1,
        });
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.getProgress(1)).rejects.toThrow("Fetched block progress block is missing for chain 1");
    await expect(repository.getProgress(1)).rejects.toThrow(
        "Fetched block timestamp is missing for chain 1 block 123"
    );
    await expect(repository.getProgress(1)).rejects.toThrow("Fetched block time is missing for chain 1");
});

test("deleteAtOrBeforeBlockNumber returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 7 }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.deleteAtOrBeforeBlockNumber(1, 100)).resolves.toBe(7);
});

test("deleteAfterBlockNumber deletes rows after block number", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 3 }));
    const repository = new PostgresBlocksRepository(createExecutor(query));

    await expect(repository.deleteAfterBlockNumber(1, 100)).resolves.toBe(3);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number > $2");
    expect(calls[0]?.[1]).toEqual([1, 100]);
});
