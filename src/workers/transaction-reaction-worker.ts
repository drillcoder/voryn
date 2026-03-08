import type { LeaderLock } from "../interfaces/leader-lock.js";
import { type Logger, noopLogger } from "../interfaces/logger.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type { TransactionStreamStore, WorkerCursorStore } from "../interfaces/stores.js";
import type { ReactionConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface TransactionReactionWorkerDeps {
    config: ReactionConfig;
    handler: TransactionReactionHandler;
    txStore: TransactionStreamStore;
    cursorStore: WorkerCursorStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class TransactionReactionWorker extends SingletonPollingWorker {
    constructor(private readonly deps: TransactionReactionWorkerDeps) {
        super(
            `reaction-tx:${String(deps.config.chainId)}:${deps.config.workerName}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { workerName, chainId, batchSize } = this.deps.config;

        const cursor = await this.deps.cursorStore.get(workerName, chainId, "tx");
        const transactions = await this.deps.txStore.readFromSeq(chainId, cursor.lastSeq, batchSize);

        for (const tx of transactions) {
            await this.deps.handler.handle(tx, { workerName });
            await this.deps.cursorStore.advance(workerName, chainId, "tx", tx.seq);
        }
    }
}
