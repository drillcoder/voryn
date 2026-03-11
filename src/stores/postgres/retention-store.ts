import type { RetentionStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresRetentionStore implements RetentionStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    purgeRawBlocks(): Promise<never> {
        return notImplemented("PostgresRetentionStore.purgeRawBlocks");
    }

    purgeCanonical(): Promise<never> {
        return notImplemented("PostgresRetentionStore.purgeCanonical");
    }
}
