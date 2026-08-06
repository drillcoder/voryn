import { EventEmitter } from "node:events";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";

interface MockQueryConfig {
    text: string;
    values?: unknown[];
    query_timeout?: number;
}

interface MockQueryResult {
    rows: Array<Record<string, boolean>>;
}

type QueryMock = jest.Mock<Promise<MockQueryResult>, [string | MockQueryConfig, unknown[]?]>;

interface MockPool {
    connect: jest.Mock<Promise<MockClient>, []>;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

class MockClient extends EventEmitter {
    readonly query: QueryMock = jest.fn<Promise<MockQueryResult>, [string | MockQueryConfig, unknown[]?]>();
    readonly release = jest.fn<undefined, [Error?]>();
}

function createPool(client: MockClient): MockPool {
    return {
        connect: jest.fn<Promise<MockClient>, []>().mockResolvedValue(client),
    };
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

afterEach(() => {
    jest.useRealTimers();
});

test("keeps one dedicated client while the lock is held", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const pool = createPool(client);
    const lock = new PostgresLeaderLock(pool as never, 123n);

    await expect(lock.tryAcquire()).resolves.toBe(true);
    await expect(lock.tryAcquire()).resolves.toBe(true);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.listenerCount("error")).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    await lock.release();
});

test("returns false and releases a healthy client when the lock is held elsewhere", async () => {
    const client = new MockClient();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 456n);

    await expect(lock.tryAcquire()).resolves.toBe(false);

    expect(client.release).toHaveBeenCalledWith();
    expect(client.listenerCount("error")).toBe(0);
});

test("discards the client when acquisition fails", async () => {
    const error = new Error("db down");
    const client = new MockClient();
    client.query.mockRejectedValueOnce(error);
    const lock = new PostgresLeaderLock(createPool(client) as never, 111n);

    await expect(lock.tryAcquire()).rejects.toBe(error);
    expect(client.release).toHaveBeenCalledWith(error);
});

test("normalizes non-Error acquisition failures", async () => {
    const client = new MockClient();
    client.query.mockRejectedValueOnce("db down");
    const lock = new PostgresLeaderLock(createPool(client) as never, 112n);

    await expect(lock.tryAcquire()).rejects.toThrow("db down");
    const releaseError = client.release.mock.calls[0]?.[0];
    expect(releaseError).toBeInstanceOf(Error);
});

test("handles a client error during acquisition without double release", async () => {
    const error = new Error("connection lost");
    const client = new MockClient();
    client.query.mockImplementationOnce(async () => {
        client.emit("error", error);
        throw error;
    });
    const listener = jest.fn();
    const lock = new PostgresLeaderLock(createPool(client) as never, 113n);
    lock.onLost(listener);

    await expect(lock.tryAcquire()).rejects.toBe(error);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(error);
    expect(listener).not.toHaveBeenCalled();
});

test("release is a noop before acquisition", async () => {
    const client = new MockClient();
    const pool = createPool(client);
    const lock = new PostgresLeaderLock(pool as never, 222n);

    await expect(lock.release()).resolves.toBeUndefined();
    expect(pool.connect).not.toHaveBeenCalled();
});

test("unlocks and returns a healthy client", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 789n);

    await lock.tryAcquire();
    await lock.release();

    const unlockQuery = client.query.mock.calls[1][0];
    if (typeof unlockQuery === "string") {
        throw new Error("Expected an unlock query config");
    }
    expect(unlockQuery.text).toContain("pg_advisory_unlock");
    expect(unlockQuery.values).toEqual(["789"]);
    expect(unlockQuery.query_timeout).toBe(10_000);
    expect(client.release).toHaveBeenCalledWith();
    expect(client.listenerCount("error")).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
});

test("returns a healthy client when unlock reports failure", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: false }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 333n);

    await lock.tryAcquire();
    await expect(lock.release()).rejects.toThrow("Failed to release advisory lock with key 333");

    expect(client.release).toHaveBeenCalledWith();
});

test("returns a healthy client when unlock returns no row", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 334n);

    await lock.tryAcquire();
    await expect(lock.release()).rejects.toThrow("Failed to release advisory lock with key 334");

    expect(client.release).toHaveBeenCalledWith();
});

test("heartbeat is a noop without an active client", async () => {
    const client = new MockClient();
    const lock = new PostgresLeaderLock(createPool(client) as never, 335n);
    const heartbeat = Reflect.get(lock, "heartbeat") as unknown;
    if (typeof heartbeat !== "function") {
        throw new Error("Expected a heartbeat method");
    }

    await Reflect.apply(heartbeat, lock, []);
    expect(client.query).not.toHaveBeenCalled();
});

test("heartbeat checks the exact lock on the dedicated client", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ held: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_001n);

    await lock.tryAcquire();
    await jest.advanceTimersByTimeAsync(30_000);

    const heartbeatQuery = client.query.mock.calls[1][0];
    if (typeof heartbeatQuery === "string") {
        throw new Error("Expected a heartbeat query config");
    }
    expect(heartbeatQuery.text).toContain("pid = pg_backend_pid()");
    expect(heartbeatQuery.values).toEqual(["10000001"]);
    expect(heartbeatQuery.query_timeout).toBe(10_000);
    expect(jest.getTimerCount()).toBe(1);

    await lock.release();
});

test("heartbeat reports a lost lock and discards the client", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ held: false }] });
    const listener = jest.fn<undefined, [Error]>();
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_002n);
    lock.onLost(listener);

    await lock.tryAcquire();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(listener).toHaveBeenCalledTimes(1);
    const lossError = listener.mock.calls[0][0];
    expect(client.release).toHaveBeenCalledWith(lossError);
    expect(jest.getTimerCount()).toBe(0);
});

test("heartbeat errors report lock loss once", async () => {
    jest.useFakeTimers();
    const error = new Error("heartbeat timeout");
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockRejectedValueOnce(error);
    const listener = jest.fn();
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_003n);
    lock.onLost(listener);

    await lock.tryAcquire();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(error);
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("a client error is handled without an unhandled error event", async () => {
    jest.useFakeTimers();
    const error = new Error("Connection terminated unexpectedly");
    const client = new MockClient();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    const listener = jest.fn();
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_004n);
    lock.onLost(listener);

    await lock.tryAcquire();
    expect(() => client.emit("error", error)).not.toThrow();

    expect(listener).toHaveBeenCalledWith(error);
    expect(client.release).toHaveBeenCalledWith(error);
    await expect(lock.release()).resolves.toBeUndefined();
});

test("a stale client error listener does not affect a released lock", async () => {
    jest.useFakeTimers();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_005n);

    await lock.tryAcquire();
    const errorListener = client.listeners("error")[0];
    await lock.release();

    Reflect.apply(errorListener, client, [new Error("stale error")]);
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("a client error during release does not report lock loss", async () => {
    jest.useFakeTimers();
    const error = new Error("connection lost during release");
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockImplementationOnce(async () => {
            client.emit("error", error);
            throw error;
        });
    const listener = jest.fn();
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_006n);
    lock.onLost(listener);

    await lock.tryAcquire();
    await expect(lock.release()).rejects.toBe(error);
    expect(listener).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("a heartbeat completing during release does not start another heartbeat", async () => {
    jest.useFakeTimers();
    const heartbeat = createDeferred<{ rows: Array<{ held: boolean }> }>();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockReturnValueOnce(heartbeat.promise)
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_007n);

    await lock.tryAcquire();
    await jest.advanceTimersByTimeAsync(30_000);
    await lock.release();
    heartbeat.resolve({ rows: [{ held: true }] });
    await jest.advanceTimersByTimeAsync(0);

    expect(jest.getTimerCount()).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("a heartbeat error after release does not affect the released client", async () => {
    jest.useFakeTimers();
    const heartbeat = createDeferred<{ rows: Array<{ held: boolean }> }>();
    const client = new MockClient();
    client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockReturnValueOnce(heartbeat.promise)
        .mockResolvedValueOnce({ rows: [{ released: true }] });
    const listener = jest.fn();
    const lock = new PostgresLeaderLock(createPool(client) as never, 10_000_008n);
    lock.onLost(listener);

    await lock.tryAcquire();
    await jest.advanceTimersByTimeAsync(30_000);
    await lock.release();
    heartbeat.reject(new Error("stale heartbeat error"));
    await jest.advanceTimersByTimeAsync(0);

    expect(listener).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
});
