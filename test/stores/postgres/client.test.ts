import {
    createPostgresPool,
    withTransaction,
    type PgPool,
    type PgPoolClient,
} from "../../../src/stores/postgres/index.js";
import { Pool } from "pg";

jest.mock("pg", () => ({
    Pool: jest.fn(),
}));

const createPoolWithClient = (client: PgPoolClient): PgPool =>
    ({
        connect: async () => client,
    } as unknown as PgPool);

test("createPostgresPool creates pg.Pool with provided config", () => {
    const fakePool = {} as PgPool;

    const mockedPool = Pool as unknown as jest.Mock;
    mockedPool.mockImplementation(() => fakePool);

    const config = { host: "localhost", port: 5432, database: "voryn" };

    const pool = createPostgresPool(config);

    expect(mockedPool).toHaveBeenCalledWith(config);
    expect(pool).toBe(fakePool);
});

test("withTransaction commits and releases client on success", async () => {
    const executed: string[] = [];
    let released = 0;

    const client = {
        query: async (text: string) => {
            executed.push(text);
            return { rows: [], rowCount: 0 };
        },
        release: () => {
            released += 1;
        },
    } as unknown as PgPoolClient;

    const pool = createPoolWithClient(client);

    const result = await withTransaction(pool, async (tx) => {
        await tx.query("SELECT 1");
        return "ok";
    });

    expect(result).toBe("ok");
    expect(executed).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(released).toBe(1);
});

test("withTransaction rollbacks and rethrows on callback error", async () => {
    const executed: string[] = [];
    let released = 0;

    const client = {
        query: async (text: string) => {
            executed.push(text);
            return { rows: [], rowCount: 0 };
        },
        release: () => {
            released += 1;
        },
    } as unknown as PgPoolClient;

    const pool = createPoolWithClient(client);

    await expect(
        withTransaction(pool, async (tx) => {
            await tx.query("SELECT 2");
            throw new Error("boom");
        })
    ).rejects.toThrow("boom");

    expect(executed).toEqual(["BEGIN", "SELECT 2", "ROLLBACK"]);
    expect(released).toBe(1);
});

test("withTransaction preserves callback error when rollback also fails", async () => {
    const executed: string[] = [];
    let released = 0;

    const client = {
        query: async (text: string) => {
            executed.push(text);
            if (text === "ROLLBACK") {
                throw new Error("rollback-failed");
            }

            return { rows: [], rowCount: 0 };
        },
        release: () => {
            released += 1;
        },
    } as unknown as PgPoolClient;

    const pool = createPoolWithClient(client);

    await expect(
        withTransaction(pool, async (tx) => {
            await tx.query("SELECT 3");
            throw new Error("boom");
        })
    ).rejects.toThrow("boom");

    expect(executed).toEqual(["BEGIN", "SELECT 3", "ROLLBACK"]);
    expect(released).toBe(1);
});
