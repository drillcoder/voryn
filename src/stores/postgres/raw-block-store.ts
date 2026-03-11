import { notImplemented } from "./not-implemented.js";
import type { RawBlockStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresRawBlockStore implements RawBlockStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    save(): Promise<never> {
        return notImplemented("PostgresRawBlockStore.save");
    }

    get(): Promise<never> {
        return notImplemented("PostgresRawBlockStore.get");
    }
}
