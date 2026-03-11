import type { PgPool, PgQueryExecutor } from "./client.js";
import { createPostgresPool } from "./client.js";
import type { PoolConfig } from "pg";
import { PostgresBlockJobQueueStore } from "./block-job-queue-store.js";
import type { ChainCursorBootstrapper } from "./chain-cursor-store.js";
import { PostgresChainCursorStore } from "./chain-cursor-store.js";
import { PostgresEventStreamStore } from "./event-stream-store.js";
import { PostgresRawBlockStore } from "./raw-block-store.js";
import { PostgresRetentionStore } from "./retention-store.js";
import { PostgresSequencerCommitStore } from "./sequencer-commit-store.js";
import { PostgresTransactionStreamStore } from "./transaction-stream-store.js";
import { PostgresWorkerCursorStore } from "./worker-cursor-store.js";

export interface PostgresStores {
    chainCursorStore: PostgresChainCursorStore;
    blockJobQueueStore: PostgresBlockJobQueueStore;
    rawBlockStore: PostgresRawBlockStore;
    sequencerCommitStore: PostgresSequencerCommitStore;
    eventStreamStore: PostgresEventStreamStore;
    transactionStreamStore: PostgresTransactionStreamStore;
    workerCursorStore: PostgresWorkerCursorStore;
    retentionStore: PostgresRetentionStore;
}

export interface PostgresRuntime {
    pool: PgPool;
    stores: PostgresStores;

    dispose(): Promise<void>;
}

export interface PostgresStoreOptions {
    chainCursorBootstrap: ChainCursorBootstrapper;
}

export function createPostgresStores(pool: PgQueryExecutor, options: PostgresStoreOptions): PostgresStores {
    return {
        chainCursorStore: new PostgresChainCursorStore(pool, options.chainCursorBootstrap),
        blockJobQueueStore: new PostgresBlockJobQueueStore(pool),
        rawBlockStore: new PostgresRawBlockStore(pool),
        sequencerCommitStore: new PostgresSequencerCommitStore(pool),
        eventStreamStore: new PostgresEventStreamStore(pool),
        transactionStreamStore: new PostgresTransactionStreamStore(pool),
        workerCursorStore: new PostgresWorkerCursorStore(pool),
        retentionStore: new PostgresRetentionStore(pool),
    };
}

export function createPostgresRuntime(
    storeOptions: PostgresStoreOptions,
    pool?: PgPool,
    poolConfig?: PoolConfig,
): PostgresRuntime {
    const usesExternalPool = pool !== undefined;
    const runtimePool = pool ?? createPostgresPool(poolConfig);

    const dispose = usesExternalPool
        ? () => Promise.resolve()
        : () => runtimePool.end();

    return {
        pool: runtimePool,
        stores: createPostgresStores(runtimePool, storeOptions),
        dispose,
    };
}
