import { PostgresWorkerCursorsRepository } from "../../../src/repositories/postgres/index.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("get returns null when worker cursor is missing", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "tx")).resolves.toBeNull();
});

test("advance throws if cursor does not exist", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.advance("worker-a", 1, "event", 12n)).rejects.toThrow(
        "Worker cursor is missing"
    );
});

test("get maps cursor row", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            worker_name: "worker-a",
            chain_id: 1,
            stream_type: "tx",
            last_seq: "12",
            updated_at: "2026-03-30T10:00:00.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.get("worker-a", 1, "tx")).resolves.toMatchObject({
        workerName: "worker-a",
        chainId: 1,
        streamType: "tx",
        lastSeq: 12n,
    });
});

test("insert and advance succeed when rows are present", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresWorkerCursorsRepository(createExecutor(query));

    await expect(repository.insert("worker-a", 1, "event", 0n)).resolves.toBeUndefined();
    await expect(repository.advance("worker-a", 1, "event", 10n)).resolves.toBeUndefined();
});
