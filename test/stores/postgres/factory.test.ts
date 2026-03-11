import { Pool } from "pg";
import type { HashHex } from "../../../src/types/chain.js";
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
} from "../../../src/stores/postgres/index.js";

jest.mock("pg", () => ({
    Pool: jest.fn(),
}));

const HASH_1 = "0x1111111111111111111111111111111111111111111111111111111111111111" as HashHex;

test("createPostgresStores returns postgres store instances", () => {
    const pool = {} as PgPool;
    const chainCursorBootstrap = jest.fn(async () => ({
        lastEnqueuedBlock: 1,
        lastCommittedBlock: 1,
        lastCommittedHash: HASH_1,
    }));

    const stores = createPostgresStores(pool, { chainCursorBootstrap });

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
    const chainCursorBootstrap = jest.fn(async () => ({
        lastEnqueuedBlock: 1,
        lastCommittedBlock: 1,
        lastCommittedHash: HASH_1,
    }));

    const runtime = createPostgresRuntime({ chainCursorBootstrap }, externalPool);
    await runtime.dispose();

    expect(runtime.pool).toBe(externalPool);
    expect(end).not.toHaveBeenCalled();
});

test("createPostgresRuntime creates and disposes internal pool", async () => {
    const end = jest.fn(async () => undefined);
    const internalPool = { end } as unknown as PgPool;
    const mockedPool = Pool as unknown as jest.Mock;
    mockedPool.mockImplementation(() => internalPool);

    const runtime = createPostgresRuntime(
        {
            chainCursorBootstrap: async () => ({
                lastEnqueuedBlock: 1,
                lastCommittedBlock: 1,
                lastCommittedHash: HASH_1,
            }),
        },
        undefined,
        { host: "localhost", port: 5432, database: "voryn" }
    );
    await runtime.dispose();

    expect(mockedPool).toHaveBeenCalledWith({
        host: "localhost",
        port: 5432,
        database: "voryn",
    });
    expect(runtime.pool).toBe(internalPool);
    expect(end).toHaveBeenCalledTimes(1);
});
