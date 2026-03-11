import type { RawBlockStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresRawBlockStore implements RawBlockStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    save(): Promise<never> {
        return notImplemented("PostgresRawBlockStore.save");
    }

    get(): Promise<never> {
        return notImplemented("PostgresRawBlockStore.get");
    }
}
