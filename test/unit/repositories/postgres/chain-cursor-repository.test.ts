import { PostgresChainCursorRepository } from "../../../../src/repositories/postgres/index.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("get returns null when cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.get(10)).resolves.toBeNull();
});

test("get maps chain cursor row", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 10,
            last_enqueued_block: "12",
            last_committed_block: "11",
            last_committed_hash: HASH_A,
            updated_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.get(10)).resolves.toMatchObject({
        chainId: 10,
        lastEnqueuedBlock: 12,
        lastCommittedBlock: 11,
        lastCommittedHash: HASH_A,
    });
});

test("advanceLastCommitted throws when optimistic update fails", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(
        repository.advanceLastCommitted(10, 11, HASH_A, 12, HASH_A)
    ).rejects.toThrow("Failed to advance chain cursor");
});

test("setLastEnqueued throws when cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setLastEnqueued(10, 12)).rejects.toThrow("Chain cursor for chain 10 not found");
});

test("setLastCommitted throws when cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setLastCommitted(10, 12, HASH_A)).rejects.toThrow(
        "Chain cursor for chain 10 not found"
    );
});

test("setPositions throws when cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setPositions(10, 12, HASH_A, 12)).rejects.toThrow(
        "Chain cursor for chain 10 not found"
    );
});

test("setPositions updates committed and enqueued values", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await repository.setPositions(10, 12, HASH_A, 12);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    const firstQuery = calls[0]?.[0] ?? "";
    const firstParams = calls[0]?.[1] ?? [];
    expect(firstQuery).toContain("last_committed_block = $2");
    expect(firstQuery).toContain("last_committed_hash = $3");
    expect(firstQuery).toContain("last_enqueued_block = GREATEST(last_enqueued_block, $4)");
    expect(firstParams).toEqual([10, 12, HASH_A, 12]);
});

test("insert executes with on conflict", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await repository.insert({
        chainId: 10,
        lastEnqueuedBlock: 12,
        lastCommittedBlock: 11,
        lastCommittedHash: HASH_A,
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    const firstQuery = calls[0]?.[0] ?? "";
    expect(firstQuery).toContain("ON CONFLICT (chain_id) DO NOTHING");
});
