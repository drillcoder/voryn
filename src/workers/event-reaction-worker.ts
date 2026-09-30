import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { ChainCursorRepository, EventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/options.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import type { ReactionServiceConfig } from "../services/reaction-service.js";
import { ReactionService } from "../services/reaction-service.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import { ReactionPollingWorker } from "./reaction-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface EventReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    eventsRepository: EventsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type EventReactionWorkerOptions =
    RuntimeLoggerOptions
    & ReactionServiceConfig
    & RuntimeDbOptions<EventReactionWorkerDatabaseDependencies>
    & { handler: EventReactionHandler };

export class EventReactionWorker extends ReactionPollingWorker {
    static async create(options: EventReactionWorkerOptions): Promise<EventReactionWorker> {
        const logger = resolveLogger(options);
        const serviceConfig: ReactionServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            workerName: options.workerName,
            batchSize: options.batchSize,
            skipFlushInterval: options.skipFlushInterval,
            confirmations: options.confirmations,
            initialBlock: options.initialBlock,
        };
        const { dependencies, dispose } = await resolveDbDependencies<EventReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): EventReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    buildReactionWorkerLockKey("event", serviceConfig.chainId, serviceConfig.workerName),
                ),
            })
        );
        const service = new ReactionService({
            config: serviceConfig,
            streamType: "event",
            handler: options.handler,
            chainCursorRepository: dependencies.chainCursorRepository,
            eventsRepository: dependencies.eventsRepository,
            workerCursorsRepository: dependencies.workerCursorsRepository,
            transactionManager: dependencies.transactionManager,
            logger,
        });

        return new EventReactionWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly serviceConfig: ReactionServiceConfig,
        service: ReactionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `reaction-event:${String(serviceConfig.chainId)}:${serviceConfig.workerName}`,
            serviceConfig.delayBetweenTicksMs,
            logger,
            leaderLock,
            service,
            dispose
        );
    }

    protected override buildStartLogMeta(): Record<string, unknown> {
        return {
            chainId: this.serviceConfig.chainId,
            workerName: this.serviceConfig.workerName,
            batchSize: this.serviceConfig.batchSize,
            confirmations: this.serviceConfig.confirmations,
        };
    }
}
