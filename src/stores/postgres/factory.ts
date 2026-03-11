import type { PoolConfig } from "pg";
import type { Logger } from "../../interfaces/logger.js";
import { PostgresBlockJobQueueStore } from "./block-job-queue-store.js";
import { PostgresChainCursorStore } from "./chain-cursor-store.js";
import type { PgPool } from "./client.js";
import { createPostgresPool } from "./client.js";
import { PostgresEventStreamStore } from "./event-stream-store.js";
import { PostgresRawBlockStore } from "./raw-block-store.js";
import { PostgresRetentionStore } from "./retention-store.js";
import { PostgresSequencerCommitStore } from "./sequencer-commit-store.js";
import type { PostgresStoreDeps } from "./store-deps.js";
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

export interface CreatePostgresRuntimeInput {
    pool?: PgPool;
    poolConfig?: PoolConfig;
    logger?: Logger;
}

export interface PostgresRuntime {
    pool: PgPool;
    storeDeps: PostgresStoreDeps;
    stores: PostgresStores;

    dispose(): Promise<void>;
}

export function createPostgresStores(deps: PostgresStoreDeps): PostgresStores {
    return {
        chainCursorStore: new PostgresChainCursorStore(deps),
        blockJobQueueStore: new PostgresBlockJobQueueStore(deps),
        rawBlockStore: new PostgresRawBlockStore(deps),
        sequencerCommitStore: new PostgresSequencerCommitStore(deps),
        eventStreamStore: new PostgresEventStreamStore(deps),
        transactionStreamStore: new PostgresTransactionStreamStore(deps),
        workerCursorStore: new PostgresWorkerCursorStore(deps),
        retentionStore: new PostgresRetentionStore(deps),
    };
}

export function createPostgresRuntime(input: CreatePostgresRuntimeInput = {}): PostgresRuntime {
    const usesExternalPool = input.pool !== undefined;
    const pool = input.pool ?? createPostgresPool(input.poolConfig);
    const storeDeps: PostgresStoreDeps = { pool, logger: input.logger };

    const dispose = usesExternalPool
        ? () => Promise.resolve()
        : () => pool.end();

    return {
        pool,
        storeDeps,
        stores: createPostgresStores(storeDeps),
        dispose,
    };
}
