import type { LeaderLock } from "../contracts/leader-lock.js";
import { type Logger, noopLogger } from "../contracts/logger.js";
import type { RetentionStore } from "../contracts/stores.js";
import type { IngestionConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

const hoursToDate = (hours: number): Date =>
    new Date(Date.now() - hours * 60 * 60 * 1000);

export interface RetentionWorkerDeps {
    config: IngestionConfig;
    store: RetentionStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class RetentionWorker extends SingletonPollingWorker {
    constructor(private readonly deps: RetentionWorkerDeps) {
        super(
            `retention:${deps.config.chainId}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { chainId, retention } = this.deps.config;

        if (retention.rawBlocksHours > 0) {
            await this.deps.store.purgeRawBlocks(chainId, hoursToDate(retention.rawBlocksHours));
        }

        if (retention.canonicalHours > 0) {
            await this.deps.store.purgeCanonical(chainId, hoursToDate(retention.canonicalHours));
        }
    }
}
