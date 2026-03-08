import type { LeaderLock } from "../interfaces/leader-lock.js";
import { type Logger, noopLogger } from "../interfaces/logger.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { EventStreamStore, WorkerCursorStore } from "../interfaces/stores.js";
import type { ReactionConfig } from "../types/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface EventReactionWorkerDeps {
    config: ReactionConfig;
    handler: EventReactionHandler;
    eventStore: EventStreamStore;
    cursorStore: WorkerCursorStore;
    leaderLock: LeaderLock;
    logger?: Logger;
}

export class EventReactionWorker extends SingletonPollingWorker {
    constructor(private readonly deps: EventReactionWorkerDeps) {
        super(
            `reaction-event:${String(deps.config.chainId)}:${deps.config.workerName}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger,
            deps.leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { workerName, chainId, batchSize } = this.deps.config;

        const cursor = await this.deps.cursorStore.get(workerName, chainId, "event");
        const events = await this.deps.eventStore.readFromSeq(chainId, cursor.lastSeq, batchSize);

        for (const event of events) {
            await this.deps.handler.handle(event, { workerName });
            await this.deps.cursorStore.advance(workerName, chainId, "event", event.seq);
        }
    }
}
