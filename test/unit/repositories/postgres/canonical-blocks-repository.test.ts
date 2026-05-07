import {
    PostgresCanonicalBlocksRepository
} from "../../../../src/repositories/postgres/canonical-blocks-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("insert writes canonical block", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await repository.insert({
        chainId: 1,
        number: 10,
        hash: HASH_A,
        parentHash: HASH_B,
        timestamp: 123,
        raw: { any: true },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, 10, HASH_A, HASH_B, 123, { any: true }]);
});

test("get returns null when canonical block is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 10)).resolves.toBeNull();
});

test("get maps canonical block row", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "10",
            block_hash: HASH_A,
            parent_hash: HASH_B,
            block_timestamp: "123",
            raw: { any: true },
        }],
        rowCount: 1,
    }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.get(1, 10)).resolves.toEqual({
        chainId: 1,
        number: 10,
        hash: HASH_A,
        parentHash: HASH_B,
        timestamp: 123,
        raw: { any: true },
    });
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(2);
});

test("deleteUpToBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(0);
});

test("deleteAfterBlock deletes blocks after block number", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 100)).resolves.toBe(2);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("block_number > $2");
    expect(calls[0]?.[1]).toEqual([1, 100]);
});

test("deleteAfterBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.deleteAfterBlock(1, 100)).resolves.toBe(0);
});
