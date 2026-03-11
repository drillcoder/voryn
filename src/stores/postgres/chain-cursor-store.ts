import type { ChainCursorStore } from "../../interfaces/stores.js";
import type { BlockNumber, ChainId, HashHex } from "../../types/chain.js";
import { notImplemented } from "./not-implemented.js";
import type { PgPool } from "./client.js";

export interface ChainCursorBootstrap {
    lastEnqueuedBlock: BlockNumber;
    lastCommittedBlock: BlockNumber;
    lastCommittedHash: HashHex;
}

export type ChainCursorBootstrapper = (chainId: ChainId) => Promise<ChainCursorBootstrap>;

export class PostgresChainCursorStore implements ChainCursorStore {
    constructor(
        private readonly pool: PgPool,
        private readonly bootstrap: ChainCursorBootstrapper
    ) {
        void this.pool;
        void this.bootstrap;
    }

    get(): Promise<never> {
        return notImplemented("PostgresChainCursorStore.get");
    }

    setLastEnqueued(): Promise<never> {
        return notImplemented("PostgresChainCursorStore.setLastEnqueued");
    }
}
