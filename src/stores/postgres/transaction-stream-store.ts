import { notImplemented } from "./not-implemented.js";
import type { TransactionStreamStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresTransactionStreamStore implements TransactionStreamStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    readFromSeq(): Promise<never> {
        return notImplemented("PostgresTransactionStreamStore.readFromSeq");
    }
}
