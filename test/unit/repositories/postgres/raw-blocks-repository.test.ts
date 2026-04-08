import { PostgresRawBlocksRepository } from "../../../../src/repositories/postgres/index.js";
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

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 7 }));
    const repository = new PostgresRawBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(7);
});
