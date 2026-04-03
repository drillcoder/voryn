import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { noopLogger } from "../interfaces/logger.js";

export class EventReactionWorker extends SingletonPollingWorker {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: EventReactionHandler,
        private readonly eventsRepository: CanonicalEventsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        leaderLock: LeaderLock,
        logger?: Logger,
    ) {
        super(
            `reaction-event:${String(config.chainId)}:${config.workerName}`,
            config.pollIntervalMs,
            logger ?? noopLogger,
            leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const cursor = await this.getOrCreateCursor(workerName, chainId);
        const events = await this.eventsRepository.readFromSeq(chainId, cursor.lastSeq, batchSize);

        for (const event of events) {
            await this.handler.handle(event, { workerName });
            await this.workerCursorsRepository.advance(workerName, chainId, "event", event.seq);
        }
    }

    private async getOrCreateCursor(workerName: string, chainId: number): Promise<{ lastSeq: bigint }> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "event");
        if (current !== null) {
            return { lastSeq: current.lastSeq };
        }

        const initialSeq = await this.eventsRepository.maxSeq(chainId);
        await this.workerCursorsRepository.insert(workerName, chainId, "event", initialSeq);
        return { lastSeq: initialSeq };
    }
}
