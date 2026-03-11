import type { EventStreamStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresEventStreamStore implements EventStreamStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    readFromSeq(): Promise<never> {
        return notImplemented("PostgresEventStreamStore.readFromSeq");
    }
}
