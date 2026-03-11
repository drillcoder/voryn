import { notImplemented } from "./not-implemented.js";
import type { RetentionStore } from "../../interfaces/stores.js";
import type { PgQueryExecutor } from "./client.js";

export class PostgresRetentionStore implements RetentionStore {
    constructor(
        private readonly pool: PgQueryExecutor,
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
