import { PostgresLeaderLock } from "../../src/postgres/index.js";

interface MockClient {
    query: jest.Mock;
    release: jest.Mock;
}

interface MockPool {
    connect: jest.Mock;
}

const createClient = (query: jest.Mock): MockClient => ({
    query,
    release: jest.fn(),
});

const createPool = (clients: MockClient[]): MockPool => {
    const connect = jest.fn();
    for (const client of clients) {
        connect.mockResolvedValueOnce(client);
    }

    return { connect };
};

test("tryAcquire keeps dedicated connection while lock is held", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ acquired: true }], rowCount: 1 });
    const client = createClient(query);
    const pool = createPool([client]);
    const lock = new PostgresLeaderLock(pool as never, 123n);

    await expect(lock.tryAcquire()).resolves.toBe(true);
    await expect(lock.tryAcquire()).resolves.toBe(true);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalled();
});

test("tryAcquire returns false and releases connection when lock is already held", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ acquired: false }], rowCount: 1 });
    const client = createClient(query);
    const pool = createPool([client]);
    const lock = new PostgresLeaderLock(pool as never, 456n);

    await expect(lock.tryAcquire()).resolves.toBe(false);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("release unlocks and frees dedicated connection", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ released: true }], rowCount: 1 });
    const client = createClient(query);
    const pool = createPool([client]);
    const lock = new PostgresLeaderLock(pool as never, 789n);

    await lock.tryAcquire();
    await lock.release();

    const calls = query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[1]?.[0]).toContain("pg_advisory_unlock");
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("tryAcquire releases connection when query fails", async () => {
    const query = jest.fn().mockRejectedValue(new Error("db down"));
    const client = createClient(query);
    const pool = createPool([client]);
    const lock = new PostgresLeaderLock(pool as never, 111n);

    await expect(lock.tryAcquire()).rejects.toThrow("db down");
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("release is noop when lock was not acquired", async () => {
    const pool = createPool([]);
    const lock = new PostgresLeaderLock(pool as never, 222n);

    await expect(lock.release()).resolves.toBeUndefined();
    expect(pool.connect).not.toHaveBeenCalled();
});

test("release throws when advisory unlock reports failure", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ released: false }], rowCount: 1 });
    const client = createClient(query);
    const pool = createPool([client]);
    const lock = new PostgresLeaderLock(pool as never, 333n);

    await lock.tryAcquire();
    await expect(lock.release()).rejects.toThrow("Failed to release advisory lock with key 333");
    expect(client.release).toHaveBeenCalledTimes(1);
});
