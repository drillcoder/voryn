import { notImplemented } from "./not-implemented.js";
import type { WorkerCursorStore } from "../../interfaces/stores.js";
import type { PgQueryExecutor } from "./client.js";

export class PostgresWorkerCursorStore implements WorkerCursorStore {
    constructor(
        private readonly pool: PgQueryExecutor,
    ) {
        void this.pool;
    }

    get(): Promise<never> {
        return notImplemented("PostgresWorkerCursorStore.get");
    }

    advance(): Promise<never> {
        return notImplemented("PostgresWorkerCursorStore.advance");
    }
}
