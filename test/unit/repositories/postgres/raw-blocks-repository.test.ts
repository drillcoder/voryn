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

test("save stores fetched block payload", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));
    const payload = {
        block: { chainId: 1, number: 100, hash: HASH_A, parentHash: HASH_B, timestamp: 1 },
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

test("getProgress maps fetched block boundary and fetch time", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            max_fetched_block: "123",
            max_fetched_block_timestamp: "1711792800",
            last_fetched_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.getProgress(1)).resolves.toEqual({
        block: 123,
        blockTimestamp: 1711792800,
        updatedAt: new Date("2026-03-30T10:00:00.000Z"),
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("ORDER BY block_number DESC");
    expect(calls[0]?.[0]).toContain("MAX(fetched_at)");
    expect(calls[0]?.[1]).toEqual([1]);
});

test("getProgress returns null when raw block table is empty", async () => {
    const query = jest.fn(async () => ({
        rows: [],
        rowCount: 0,
    }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

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
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.getProgress(1)).rejects.toThrow("Raw block progress block is missing for chain 1");
    await expect(repository.getProgress(1)).rejects.toThrow(
        "Raw block timestamp is missing for chain 1 block 123"
    );
    await expect(repository.getProgress(1)).rejects.toThrow("Raw block fetch time is missing for chain 1");
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 7 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(7);
});

test("deleteUpToBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(0);
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
