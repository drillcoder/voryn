import { notImplemented } from "./not-implemented.js";
import type { BlockJobQueueStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresBlockJobQueueStore implements BlockJobQueueStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    enqueueRange(): Promise<never> {
        return notImplemented("PostgresBlockJobQueueStore.enqueueRange");
    }

    claimForFetch(): Promise<never> {
        return notImplemented("PostgresBlockJobQueueStore.claimForFetch");
    }

    markFetched(): Promise<never> {
        return notImplemented("PostgresBlockJobQueueStore.markFetched");
    }

    markFetchFailed(): Promise<never> {
        return notImplemented("PostgresBlockJobQueueStore.markFetchFailed");
    }
}
