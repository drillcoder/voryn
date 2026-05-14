import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresCanonicalEventsRepository } from "../repositories/postgres/canonical-events-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { EventReactionService } from "../services/event-reaction-service.js";
import { resolveDbDependencies } from "../runtime/resolvers.js";
import type { ReactionWorkerOptions } from "../runtime/types.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

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
        const { dependencies, dispose } = await resolveDbDependencies<EventReactionWorkerDatabaseDependencies>(
            options,
            (pool: Pool): EventReactionWorkerDatabaseDependencies => ({
                canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                leaderLock: new PostgresLeaderLock(pool, buildReactionWorkerLockKey("event", options.config)),
            })
        );
        const service = new EventReactionService(
            options.config,
            options.handler,
            dependencies.canonicalEventsRepository,
            dependencies.workerCursorsRepository,
            options.logger
        );

        return new EventReactionWorker(options.config, service, dependencies.leaderLock, dispose, options.logger);
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
