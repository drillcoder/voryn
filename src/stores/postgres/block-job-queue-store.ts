import type { BlockJobQueueStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresBlockJobQueueStore implements BlockJobQueueStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
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
