import { Pool } from "pg";
import {
    PostgresBlockJobQueueStore,
    PostgresChainCursorStore,
    PostgresEventStreamStore,
    PostgresRawBlockStore,
    PostgresRetentionStore,
    PostgresSequencerCommitStore,
    PostgresTransactionStreamStore,
    PostgresWorkerCursorStore,
    createPostgresRuntime,
    createPostgresStores,
    type PgPool,
    type PostgresStoreDeps,
} from "../../../src/stores/postgres/index.js";

jest.mock("pg", () => ({
    Pool: jest.fn(),
}));

test("createPostgresStores returns postgres store instances", () => {
    const deps: PostgresStoreDeps = { pool: {} as PgPool };

    const stores = createPostgresStores(deps);

    expect(stores.chainCursorStore).toBeInstanceOf(PostgresChainCursorStore);
    expect(stores.blockJobQueueStore).toBeInstanceOf(PostgresBlockJobQueueStore);
    expect(stores.rawBlockStore).toBeInstanceOf(PostgresRawBlockStore);
    expect(stores.sequencerCommitStore).toBeInstanceOf(PostgresSequencerCommitStore);
    expect(stores.eventStreamStore).toBeInstanceOf(PostgresEventStreamStore);
    expect(stores.transactionStreamStore).toBeInstanceOf(PostgresTransactionStreamStore);
    expect(stores.workerCursorStore).toBeInstanceOf(PostgresWorkerCursorStore);
    expect(stores.retentionStore).toBeInstanceOf(PostgresRetentionStore);
});

test("createPostgresRuntime reuses external pool and does not dispose it", async () => {
    const end = jest.fn(async () => undefined);
    const externalPool = { end } as unknown as PgPool;

    const runtime = createPostgresRuntime({ pool: externalPool });
    await runtime.dispose();

    expect(runtime.pool).toBe(externalPool);
    expect(end).not.toHaveBeenCalled();
});

test("createPostgresRuntime creates and disposes internal pool", async () => {
    const end = jest.fn(async () => undefined);
    const internalPool = { end } as unknown as PgPool;
    const mockedPool = Pool as unknown as jest.Mock;
    mockedPool.mockImplementation(() => internalPool);

    const runtime = createPostgresRuntime({
        poolConfig: { host: "localhost", port: 5432, database: "voryn" },
    });
    await runtime.dispose();

    expect(mockedPool).toHaveBeenCalledWith({
        host: "localhost",
        port: 5432,
        database: "voryn",
    });
    expect(runtime.pool).toBe(internalPool);
    expect(end).toHaveBeenCalledTimes(1);
});
