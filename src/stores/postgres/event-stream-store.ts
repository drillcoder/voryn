import { notImplemented } from "./not-implemented.js";
import type { EventStreamStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresEventStreamStore implements EventStreamStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    readFromSeq(): Promise<never> {
        return notImplemented("PostgresEventStreamStore.readFromSeq");
    }
}
