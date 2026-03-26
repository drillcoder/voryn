import type { LeaderLock } from "../interfaces/leader-lock.js";
import { type Logger, noopLogger } from "../interfaces/logger.js";
import type { RetentionStore } from "../interfaces/stores.js";
import type { RetentionWorkerConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface RetentionWorkerDeps {
    config: RetentionWorkerConfig;
    store: RetentionStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class RetentionWorker extends SingletonPollingWorker {
    constructor(private readonly deps: RetentionWorkerDeps) {
        super(
            `retention:${String(deps.config.chainId)}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { chainId, retention } = this.deps.config;

        if (retention.depthBlocks > 0) {
            const result = await this.deps.store.purge(chainId, retention.depthBlocks);
            this.logger.info("retention_purged", {
                chainId,
                depthBlocks: retention.depthBlocks,
                ...result,
            });
        }
    }
}
