import type { Mock } from "vitest";
import { expect, test, vi } from "vitest";

import { PostgresChainCursorRepository } from "../../../../src/repositories/postgres/chain-cursor-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const createExecutor = (query: Mock): DbExecutor => ({ query: query as never });

test("get returns null when cursor is missing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.get(10)).resolves.toBeNull();
});

test("get maps chain cursor row", async () => {
    const query = vi.fn(async () => ({
        rows: [{
            chain_id: 10,
            last_enqueued_block: "12",
            last_committed_block: "11",
            last_committed_hash: HASH_A,
            reorg_version: "0",
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
        reorgVersion: 0,
    });
});

test("getForUpdate maps chain cursor row and locks it", async () => {
    const query = vi.fn(async () => ({
        rows: [{
            chain_id: 10,
            last_enqueued_block: "12",
            last_committed_block: "11",
            last_committed_hash: HASH_A,
            reorg_version: "0",
            updated_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.getForUpdate(10, createExecutor(query))).resolves.toMatchObject({
        chainId: 10,
        lastEnqueuedBlock: 12,
        lastCommittedBlock: 11,
        lastCommittedHash: HASH_A,
        reorgVersion: 0,
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("FOR UPDATE");
    expect(calls[0]?.[1]).toEqual([10]);
});

test("getForUpdate returns null when cursor is missing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const executor = createExecutor(query);
    const repository = new PostgresChainCursorRepository(executor);

    await expect(repository.getForUpdate(10, executor)).resolves.toBeNull();
});

test("advanceLastCommitted throws when optimistic update fails", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(
        repository.advanceLastCommitted(10, 11, HASH_A, 12, HASH_A)
    ).rejects.toThrow("Failed to advance chain cursor");
});

test("advanceLastCommitted throws when rowCount is null", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(
        repository.advanceLastCommitted(10, 11, HASH_A, 12, HASH_A)
    ).rejects.toThrow("Failed to advance chain cursor");
});

test("advanceLastCommitted succeeds when one row is updated", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(
        repository.advanceLastCommitted(10, 11, HASH_A, 12, HASH_A)
    ).resolves.toBeUndefined();
});

test("setLastEnqueued throws when cursor is missing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setLastEnqueued(10, 12)).rejects.toThrow("Chain cursor for chain 10 not found");
});

test("setLastEnqueued throws when rowCount is null", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setLastEnqueued(10, 12)).rejects.toThrow("Chain cursor for chain 10 not found");
});

test("setLastEnqueued succeeds when cursor exists", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setLastEnqueued(10, 12)).resolves.toBeUndefined();
});

test("setPositions throws when cursor is missing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setPositions(10, 12, HASH_A, 12)).rejects.toThrow(
        "Chain cursor for chain 10 not found"
    );
});

test("setPositions throws when rowCount is null", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await expect(repository.setPositions(10, 12, HASH_A, 12)).rejects.toThrow(
        "Chain cursor for chain 10 not found"
    );
});

test("setPositions updates committed and enqueued values", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await repository.setPositions(10, 12, HASH_A, 12);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    const firstQuery = calls[0]?.[0] ?? "";
    const firstParams = calls[0]?.[1] ?? [];
    expect(firstQuery).toContain("last_committed_block = $2");
    expect(firstQuery).toContain("last_committed_hash = $3");
    expect(firstQuery).toContain("last_enqueued_block = $4");
    expect(firstParams).toEqual([10, 12, HASH_A, 12]);
});

test("setPositionsAndIncrementReorgVersion returns the new version", async () => {
    const query = vi.fn(async () => ({ rows: [{ reorg_version: "7" }], rowCount: 1 }));
    const executor = createExecutor(query);
    const repository = new PostgresChainCursorRepository(executor);

    await expect(
        repository.setPositionsAndIncrementReorgVersion(10, 12, HASH_A, 12, executor)
    ).resolves.toBe(7);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("reorg_version = reorg_version + 1");
    expect(calls[0]?.[0]).toContain("RETURNING reorg_version");
    expect(calls[0]?.[1]).toEqual([10, 12, HASH_A, 12]);
});

test.each([
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: null },
    { rows: [], rowCount: 1 },
])("setPositionsAndIncrementReorgVersion rejects an invalid update result", async (result) => {
    const query = vi.fn(async () => result);
    const executor = createExecutor(query);
    const repository = new PostgresChainCursorRepository(executor);

    await expect(
        repository.setPositionsAndIncrementReorgVersion(10, 12, HASH_A, 12, executor)
    ).rejects.toThrow("Chain cursor for chain 10 not found");
});

test("insert executes with on conflict", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresChainCursorRepository(createExecutor(query));

    await repository.insert({
        chainId: 10,
        lastEnqueuedBlock: 12,
        lastCommittedBlock: 11,
        lastCommittedHash: HASH_A,
        reorgVersion: 3,
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    const firstQuery = calls[0]?.[0] ?? "";
    expect(firstQuery).toContain("ON CONFLICT (chain_id) DO NOTHING");
    expect(calls[0]?.[1]).toEqual([10, 12, 11, HASH_A, 3]);
});
