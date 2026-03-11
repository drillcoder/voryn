import { notImplemented } from "./not-implemented.js";
import type { RetentionStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresRetentionStore implements RetentionStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    purgeRawBlocks(): Promise<never> {
        return notImplemented("PostgresRetentionStore.purgeRawBlocks");
    }

    purgeCanonical(): Promise<never> {
        return notImplemented("PostgresRetentionStore.purgeCanonical");
    }
}
