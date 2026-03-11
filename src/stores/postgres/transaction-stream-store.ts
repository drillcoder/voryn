import type { TransactionStreamStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresTransactionStreamStore implements TransactionStreamStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    readFromSeq(): Promise<never> {
        return notImplemented("PostgresTransactionStreamStore.readFromSeq");
    }
}
