import { notImplemented } from "./not-implemented.js";
import type { SequencerCommitStore } from "../../interfaces/stores.js";
import type { PgPool } from "./client.js";

export class PostgresSequencerCommitStore implements SequencerCommitStore {
    constructor(
        private readonly pool: PgPool,
    ) {
        void this.pool;
    }

    commitNextBlock(): Promise<never> {
        return notImplemented("PostgresSequencerCommitStore.commitNextBlock");
    }
}
