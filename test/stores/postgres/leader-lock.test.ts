import { PostgresLeaderLock } from "../../../src/stores/postgres/index.js";
import type { PgPool } from "../../../src/stores/postgres/index.js";

interface MockClient {
    query: jest.Mock;
    release: jest.Mock;
}

const createClient = (query: jest.Mock): MockClient => ({
    query,
    release: jest.fn(),
});

const createPool = (clients: MockClient[]): { pool: PgPool; connect: jest.Mock } => {
    const connect = jest.fn();
    for (const client of clients) {
        connect.mockResolvedValueOnce(client);
    }

    return {
        pool: {
            connect,
        } as unknown as PgPool,
        connect,
    };
};

test("tryAcquire keeps dedicated connection while lock is held", async () => {
    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ acquired: true }], rowCount: 1 });
    const client = createClient(clientQuery);
    const { pool, connect } = createPool([client]);
    const lock = new PostgresLeaderLock(pool, 123n);

    await expect(lock.tryAcquire()).resolves.toBe(true);
    await expect(lock.tryAcquire()).resolves.toBe(true);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    const calls = clientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[0]).toContain("pg_try_advisory_lock");
    expect(calls[0]?.[1]).toEqual(["123"]);
    expect(client.release.mock.calls).toHaveLength(0);
});

test("tryAcquire returns false and releases connection when lock is already held", async () => {
    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ acquired: false }], rowCount: 1 });
    const client = createClient(clientQuery);
    const { pool, connect } = createPool([client]);
    const lock = new PostgresLeaderLock(pool, 456n);

    await expect(lock.tryAcquire()).resolves.toBe(false);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls).toHaveLength(1);
});

test("tryAcquire releases connection when query fails", async () => {
    const clientQuery = jest.fn().mockRejectedValue(new Error("db down"));
    const client = createClient(clientQuery);
    const { pool } = createPool([client]);
    const lock = new PostgresLeaderLock(pool, 777n);

    await expect(lock.tryAcquire()).rejects.toThrow("db down");
    expect(client.release.mock.calls).toHaveLength(1);
});

test("release unlocks and frees dedicated connection", async () => {
    const acquireClientQuery = jest.fn().mockResolvedValue({ rows: [{ acquired: true }], rowCount: 1 });
    const acquireClient = createClient(acquireClientQuery);
    const { pool } = createPool([acquireClient]);
    const lock = new PostgresLeaderLock(pool, 789n);

    await lock.tryAcquire();

    acquireClientQuery.mockResolvedValueOnce({ rows: [{ released: true }], rowCount: 1 });
    await expect(lock.release()).resolves.toBeUndefined();

    const calls = acquireClientQuery.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[1]?.[0]).toContain("pg_advisory_unlock");
    expect(calls[1]?.[1]).toEqual(["789"]);
    expect(acquireClient.release.mock.calls).toHaveLength(1);
});

test("release throws when advisory unlock reports failure", async () => {
    const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ released: false }], rowCount: 1 });
    const client = createClient(clientQuery);
    const { pool } = createPool([client]);
    const lock = new PostgresLeaderLock(pool, 999n);

    await lock.tryAcquire();
    await expect(lock.release()).rejects.toThrow("Failed to release advisory lock with key 999");
    expect(client.release.mock.calls).toHaveLength(1);
});

test("release is a no-op when lock was not acquired", async () => {
    const { pool, connect } = createPool([]);
    const lock = new PostgresLeaderLock(pool, 100n);

    await expect(lock.release()).resolves.toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
});
