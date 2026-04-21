import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { buildEventReactionWorker } from "./worker-builder.js";
import type { ReactionWorkerOptions } from "./worker-types.js";
import type { EventReactionService } from "../services/event-reaction-service.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface EventReactionWorkerDatabaseDependencies {
    canonicalEventsRepository: CanonicalEventsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    leaderLock: LeaderLock;
}

export type CreateEventReactionWorkerOptions = ReactionWorkerOptions<
    ReactionWorkerConfig,
    EventReactionHandler,
    EventReactionWorkerDatabaseDependencies
>;

export class EventReactionWorker extends SingletonPollingWorker {
    static async create(options: CreateEventReactionWorkerOptions): Promise<EventReactionWorker> {
        const { service, leaderLock, dispose } = await buildEventReactionWorker(options);
        return new EventReactionWorker(options.config, service, leaderLock, dispose, options.logger);
    }

    private constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly service: EventReactionService,
        leaderLock: LeaderLock,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `reaction-event:${String(config.chainId)}:${config.workerName}`,
            config.delayBetweenTicksMs,
            logger ?? noopLogger,
            leaderLock,
            dispose
        );
    }

    protected async tick(): Promise<void> {
        await this.service.execute();
    }

    protected override buildStartLogMeta(): Record<string, unknown> {
        return {
            chainId: this.config.chainId,
            workerName: this.config.workerName,
            batchSize: this.config.batchSize,
        };
    }
}
