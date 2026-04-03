import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/index.js";
import type { DbExecutor } from "../../../src/interfaces/db.js";

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("claimForFetch returns null when queue is empty", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    const claimed = await repository.claimForFetch(1, "worker-a", new Date("2026-03-30T10:00:00.000Z"));

    expect(claimed).toBeNull();
});

test("claimForFetch maps row and passes stale threshold", async () => {
    const staleBefore = new Date("2026-03-30T10:00:00.000Z");
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "42",
            status: "fetching",
            attempts: 2,
            next_retry_at: null,
            error: null,
            claimed_at: "2026-03-30T10:01:00.000Z",
            updated_at: "2026-03-30T10:01:10.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    const claimed = await repository.claimForFetch(1, "worker-a", staleBefore);

    expect(claimed).toMatchObject({
        chainId: 1,
        blockNumber: 42,
        status: "fetching",
        attempts: 2,
        nextRetryAt: null,
    });
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, "worker-a", staleBefore]);
});

test("claimForFetch maps nullable claimedAt and non-null retry date", async () => {
    const query = jest.fn(async () => ({
        rows: [{
            chain_id: 1,
            block_number: "43",
            status: "failed",
            attempts: 3,
            next_retry_at: "2026-03-30T10:01:00.000Z",
            error: "err",
            claimed_at: null,
            updated_at: "2026-03-30T10:01:10.000Z",
        }],
        rowCount: 1,
    }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    const claimed = await repository.claimForFetch(1, "worker-a", new Date("2026-03-30T10:00:00.000Z"));

    expect(claimed?.nextRetryAt).toBeInstanceOf(Date);
    expect(claimed?.claimedAt).toBeNull();
});

test("markFetchFailed throws when ownership is lost", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetchFailed(1, 99, "worker-a", "boom", null)).rejects.toThrow(
        "Cannot mark block job as failed"
    );
});

test("enqueueRange skips query when range is empty", async () => {
    const query = jest.fn();
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await repository.enqueueRange(1, 10, 9);

    expect(query).not.toHaveBeenCalled();
});

test("enqueueRange writes range when bounds are valid", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 3 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await repository.enqueueRange(1, 10, 12);

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual([1, 10, 12]);
});

test("markFetched succeeds when row exists", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetched(1, 7, "worker-a")).resolves.toBeUndefined();
});

test("markFetched throws when ownership is lost", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetched(1, 7, "worker-a")).rejects.toThrow(
        "Cannot mark block job as fetched"
    );
});

test("markFetched treats rowCount=null as not updated", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetched(1, 7, "worker-a")).rejects.toThrow(
        "Cannot mark block job as fetched"
    );
});

test("markFetchFailed succeeds when row exists", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetchFailed(1, 7, "worker-a", "boom", null)).resolves.toBeUndefined();
});

test("markFetchFailed treats rowCount=null as not updated", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markFetchFailed(1, 7, "worker-a", "boom", null)).rejects.toThrow(
        "Cannot mark block job as failed"
    );
});

test("markCommitted throws when row was not updated", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markCommitted(1, 10)).rejects.toThrow("Failed to mark block job as committed");
});

test("markCommitted succeeds when row was updated", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markCommitted(1, 10)).resolves.toBeUndefined();
});

test("markCommitted treats rowCount=null as failure", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.markCommitted(1, 10)).rejects.toThrow("Failed to mark block job as committed");
});

test("deleteUpToBlock returns number of deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 3 }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(3);
});

test("deleteUpToBlock returns zero when rowCount is null", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: null }));
    const repository = new PostgresBlockJobsRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 10)).resolves.toBe(0);
});
