import type { Mock } from "vitest";
import { expect, test, vi } from "vitest";

import { PostgresWorkerCursorsRepository } from "../../../../src/repositories/postgres/worker-cursors-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";

const createExecutor = (query: Mock): DbExecutor => ({ query: query as never });

test("get returns null when worker cursor is missing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "transaction")).resolves.toBeNull();
});

test("advance throws if cursor does not exist", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advanceIfVersion("worker-a", 1, "event", {
        lastBlockNumber: 12,
        lastTransactionIndex: 0,
        lastLogIndex: 0,
    }, 0)).rejects.toThrow("Worker cursor is missing");
});

test("advance throws when rowCount is null", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advanceIfVersion("worker-a", 1, "event", {
        lastBlockNumber: 12,
        lastTransactionIndex: 0,
        lastLogIndex: 0,
    }, 0)).rejects.toThrow("Worker cursor is missing");
});

test("advance returns false when reorg version changed", async () => {
    const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
            rows: [{
                worker_name: "worker-a",
                chain_id: 1,
                stream_type: "event",
                last_block_number: "12",
                last_transaction_index: 0,
                last_log_index: 0,
                reorg_version: "1",
                updated_at: "2026-03-30T10:00:00.000Z",
            }],
            rowCount: 1,
        });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advanceIfVersion("worker-a", 1, "event", {
        lastBlockNumber: 13,
        lastTransactionIndex: 0,
        lastLogIndex: 0,
    }, 0)).resolves.toBe(false);
});

test("get maps cursor row", async () => {
    const query = vi.fn(async () => ({
        rows: [{
            worker_name: "worker-a",
            chain_id: 1,
            stream_type: "transaction",
            last_block_number: "12",
            last_transaction_index: 3,
            last_log_index: -1,
            reorg_version: "4",
            updated_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "transaction")).resolves.toMatchObject({
        workerName: "worker-a",
        chainId: 1,
        streamType: "transaction",
        position: {
            lastBlockNumber: 12,
            lastTransactionIndex: 3,
            lastLogIndex: -1,
        },
        reorgVersion: 4,
    });
});

test("listByChain maps cursor rows", async () => {
    const query = vi.fn(async () => ({
        rows: [
            {
                worker_name: "event-worker",
                chain_id: 1,
                stream_type: "event",
                last_block_number: "7",
                last_transaction_index: 0,
                last_log_index: 2,
                reorg_version: "2",
                updated_at: "2026-03-30T10:00:00.000Z",
            },
            {
                worker_name: "tx-worker",
                chain_id: 1,
                stream_type: "transaction",
                last_block_number: "12",
                last_transaction_index: 3,
                last_log_index: -1,
                reorg_version: "3",
                updated_at: "2026-03-30T10:01:00.000Z",
            },
        ],
        rowCount: 2,
    }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.listByChain(1)).resolves.toEqual([
        {
            workerName: "event-worker",
            chainId: 1,
            streamType: "event",
            position: {
                lastBlockNumber: 7,
                lastTransactionIndex: 0,
                lastLogIndex: 2,
            },
            reorgVersion: 2,
            updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        },
        {
            workerName: "tx-worker",
            chainId: 1,
            streamType: "transaction",
            position: {
                lastBlockNumber: 12,
                lastTransactionIndex: 3,
                lastLogIndex: -1,
            },
            reorgVersion: 3,
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
        },
    ]);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("ORDER BY worker_name, stream_type");
    expect(calls[0]?.[1]).toEqual([1]);
});

test("insert and advance succeed when rows are present", async () => {
    const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.insert("worker-a", 1, "event", {
        lastBlockNumber: 0,
        lastTransactionIndex: 0,
        lastLogIndex: -1,
    }, 0)).resolves.toBeUndefined();
    await expect(repository.advanceIfVersion("worker-a", 1, "event", {
        lastBlockNumber: 10,
        lastTransactionIndex: 1,
        lastLogIndex: 2,
    }, 0)).resolves.toBe(true);
});

test("insert and advance use the transaction log-index sentinel", async () => {
    const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await repository.insert("worker-a", 1, "transaction", {
        lastBlockNumber: 0,
        lastTransactionIndex: -1,
        lastLogIndex: -1,
    }, 4);
    await repository.advanceIfVersion("worker-a", 1, "transaction", {
        lastBlockNumber: 10,
        lastTransactionIndex: 1,
        lastLogIndex: -1,
    }, 4);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[]]>;
    expect(calls[0]?.[1]).toEqual(["worker-a", 1, "transaction", 0, -1, -1, 4]);
    expect(calls[1]?.[1]).toEqual(["worker-a", 1, "transaction", 10, 1, -1, 4]);
});

test("rewindForReorg updates affected and lagging cursors in one statement", async () => {
    const query = vi.fn().mockResolvedValue({
        rows: [{ rewound: true }, { rewound: false }, { rewound: true }],
        rowCount: 3,
    });
    const executor = createExecutor(query);
    const repository = new PostgresWorkerCursorsRepository(executor);

    await expect(repository.rewindForReorg(1, 100, 8, executor)).resolves.toBe(2);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[]]>;
    expect(query).toHaveBeenCalledTimes(1);
    expect(calls[0]?.[0]).toContain("WHEN last_block_number >= $2 THEN $2");
    expect(calls[0]?.[0]).toContain("WHEN last_block_number >= $2 THEN -1");
    expect(calls[0]?.[0]).toContain("reorg_version = $3");
    expect(calls[0]?.[0]).toContain("updated_at = NOW()");
    expect(calls[0]?.[0]).toContain("RETURNING last_block_number = $2 AS rewound");
    expect(calls[0]?.[1]).toEqual([1, 100, 8]);
});
