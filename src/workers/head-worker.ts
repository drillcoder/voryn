import type { BlockSource } from "../interfaces/block-source.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import { type Logger, noopLogger } from "../interfaces/logger.js";
import type { BlockJobQueueStore, ChainCursorStore, } from "../interfaces/stores.js";
import type { HeadWorkerConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface HeadWorkerDeps {
    config: HeadWorkerConfig;
    source: BlockSource;
    cursorStore: ChainCursorStore;
    jobStore: BlockJobQueueStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class HeadWorker extends SingletonPollingWorker {
    constructor(private readonly deps: HeadWorkerDeps) {
        super(
            `head:${String(deps.config.chainId)}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { chainId, confirmations } = this.deps.config;

        const latest = await this.deps.source.getLatestBlockNumber(chainId);
        const safeHead = latest - confirmations;

        if (safeHead < 0) {
            return;
        }

        const cursor = await this.deps.cursorStore.get(chainId);
        const fromBlock = cursor.lastEnqueuedBlock + 1;

        if (fromBlock > safeHead) {
            return;
        }

        await this.deps.jobStore.enqueueRange(chainId, fromBlock, safeHead);
        await this.deps.cursorStore.setLastEnqueued(chainId, safeHead);
    }
}
