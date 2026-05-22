import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { ChainCursorRepository, EventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { ReactionService } from "../services/reaction-service.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import type { ReactionWorkerOptions } from "../runtime/types.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface EventReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    eventsRepository: EventsRepository;
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
        const logger = resolveLogger(options);
        const { dependencies, dispose } = await resolveDbDependencies<EventReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): EventReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                leaderLock: new PostgresLeaderLock(pool, buildReactionWorkerLockKey("event", options.config)),
            })
        );
        const service = new ReactionService({
            config: options.config,
            streamType: "event",
            handler: options.handler,
            chainCursorRepository: dependencies.chainCursorRepository,
            eventsRepository: dependencies.eventsRepository,
            workerCursorsRepository: dependencies.workerCursorsRepository,
            logger,
        });

        return new EventReactionWorker(options.config, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly service: ReactionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `reaction-event:${String(config.chainId)}:${config.workerName}`,
            config.delayBetweenTicksMs,
            logger,
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
