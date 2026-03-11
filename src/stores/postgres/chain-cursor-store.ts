import type { ChainCursorStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresChainCursorStore implements ChainCursorStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    get(): Promise<never> {
        return notImplemented("PostgresChainCursorStore.get");
    }

    setLastEnqueued(): Promise<never> {
        return notImplemented("PostgresChainCursorStore.setLastEnqueued");
    }
}
