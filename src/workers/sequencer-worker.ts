import type { LeaderLock } from "../contracts/leader-lock.js";
import { type Logger, noopLogger } from "../contracts/logger.js";
import type { ChainCursorStore, SequencerCommitStore } from "../contracts/stores.js";
import type { IngestionConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface SequencerWorkerDeps {
    config: IngestionConfig;
    cursorStore: ChainCursorStore;
    commitStore: SequencerCommitStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class SequencerWorker extends SingletonPollingWorker {
    constructor(private readonly deps: SequencerWorkerDeps) {
        super(
            `sequencer:${deps.config.chainId}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const chainId = this.deps.config.chainId;
        const cursor = await this.deps.cursorStore.get(chainId);
        const nextBlock = cursor.lastCommittedBlock + 1;
        await this.deps.commitStore.commitNextBlock(chainId, nextBlock);
    }
}
