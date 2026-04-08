import { PostgresTransactionManager } from "../../../src/postgres/index.js";

interface MockClient {
    query: jest.Mock;
    release: jest.Mock;
}

interface MockPool {
    connect: jest.Mock<Promise<MockClient>, []>;
}

const createPoolWithClient = (client: MockClient): MockPool => ({
    connect: jest.fn(async () => client),
});

test("postgres transaction manager runs callback in BEGIN/COMMIT", async () => {
    const executed: string[] = [];
    const client: MockClient = {
        query: jest.fn(async (text: string) => {
            executed.push(text);
            return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
    };

    const manager = new PostgresTransactionManager(createPoolWithClient(client) as never);

    await manager.run(async (transaction) => {
        await transaction.query("SELECT 1");
        await transaction.query("SELECT 2");
    });

    expect(executed).toEqual(["BEGIN", "SELECT 1", "SELECT 2", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
});

test("postgres transaction manager rolls back on callback error", async () => {
    const executed: string[] = [];
    const client: MockClient = {
        query: jest.fn(async (text: string) => {
            executed.push(text);
            return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
    };

    const manager = new PostgresTransactionManager(createPoolWithClient(client) as never);

    await expect(manager.run(async () => {
        throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(executed).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
});
