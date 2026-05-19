import { PostgresWorkerCursorsRepository } from "../../../../src/repositories/postgres/worker-cursors-repository.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("get returns null when worker cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "tx")).resolves.toBeNull();
});

test("advance throws if cursor does not exist", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advance("worker-a", 1, "event", {
        lastBlockNumber: 12,
        lastTransactionIndex: 0,
        lastLogIndex: 0,
    })).rejects.toThrow("Worker cursor is missing");
});

test("advance throws when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advance("worker-a", 1, "event", {
        lastBlockNumber: 12,
        lastTransactionIndex: 0,
        lastLogIndex: 0,
    })).rejects.toThrow("Worker cursor is missing");
});

test("get maps cursor row", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            worker_name: "worker-a",
            chain_id: 1,
            stream_type: "tx",
            last_block_number: "12",
            last_transaction_index: 3,
            last_log_index: null,
            updated_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "tx")).resolves.toMatchObject({
        workerName: "worker-a",
        chainId: 1,
        streamType: "tx",
        position: {
            lastBlockNumber: 12,
            lastTransactionIndex: 3,
            lastLogIndex: null,
        },
    });
});

test("listByChain maps cursor rows", async () => {
    const query = jest.fn(async () => ({
        rows: [
            {
                worker_name: "event-worker",
                chain_id: 1,
                stream_type: "event",
                last_block_number: "7",
                last_transaction_index: 0,
                last_log_index: 2,
                updated_at: "2026-03-30T10:00:00.000Z",
            },
            {
                worker_name: "tx-worker",
                chain_id: 1,
                stream_type: "tx",
                last_block_number: "12",
                last_transaction_index: 3,
                last_log_index: null,
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
            updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        },
        {
            workerName: "tx-worker",
            chainId: 1,
            streamType: "tx",
            position: {
                lastBlockNumber: 12,
                lastTransactionIndex: 3,
                lastLogIndex: null,
            },
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
        },
    ]);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("ORDER BY worker_name, stream_type");
    expect(calls[0]?.[1]).toEqual([1]);
});

test("insert and advance succeed when rows are present", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.insert("worker-a", 1, "event", {
        lastBlockNumber: 0,
        lastTransactionIndex: 0,
        lastLogIndex: -1,
    })).resolves.toBeUndefined();
    await expect(repository.advance("worker-a", 1, "event", {
        lastBlockNumber: 10,
        lastTransactionIndex: 1,
        lastLogIndex: 2,
    })).resolves.toBeUndefined();
});

test("insert and advance use null for missing log index", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await repository.insert("worker-a", 1, "tx", {
        lastBlockNumber: 0,
        lastTransactionIndex: -1,
    });
    await repository.advance("worker-a", 1, "tx", {
        lastBlockNumber: 10,
        lastTransactionIndex: 1,
    });

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[]]>;
    expect(calls[0]?.[1]).toEqual(["worker-a", 1, "tx", 0, -1, null]);
    expect(calls[1]?.[1]).toEqual(["worker-a", 1, "tx", 10, 1, null]);
});
