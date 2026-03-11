import type { SequencerCommitStore } from "../../interfaces/stores.js";
import { notImplemented } from "./not-implemented.js";
import type { PostgresStoreDeps } from "./store-deps.js";

export class PostgresSequencerCommitStore implements SequencerCommitStore {
    constructor(private readonly deps: PostgresStoreDeps) {
        void this.deps;
    }

    commitNextBlock(): Promise<never> {
        return notImplemented("PostgresSequencerCommitStore.commitNextBlock");
    }
}
