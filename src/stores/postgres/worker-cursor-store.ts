import type { WorkerCursorStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresWorkerCursorStore implements WorkerCursorStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    get(): Promise<never> {
        return notImplemented("PostgresWorkerCursorStore.get");
    }

    advance(): Promise<never> {
        return notImplemented("PostgresWorkerCursorStore.advance");
    }
}
