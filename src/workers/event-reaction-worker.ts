import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { PipelineEvent } from "../interfaces/pipeline.js";
import type { ReactionCallbacks } from "../interfaces/reaction.js";
import type {
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/options.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import type { ReactionServiceConfig } from "../services/reaction-service.js";
import { ReactionService } from "../services/reaction-service.js";
import { disposeAfterError, resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import { ReactionPollingWorker } from "./reaction-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface EventReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blocksRepository: BlocksRepository;
    eventsRepository: EventsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type EventReactionWorkerOptions<TContext = undefined> =
    RuntimeLoggerOptions
    & ReactionServiceConfig
    & RuntimeDbOptions<EventReactionWorkerDatabaseDependencies>
    & ReactionCallbacks<PipelineEvent, TContext>;

export class EventReactionWorker<TContext = undefined> extends ReactionPollingWorker<TContext> {
    static async create<TContext = undefined>(
        options: EventReactionWorkerOptions<TContext>,
    ): Promise<EventReactionWorker<TContext>> {
        const logger = resolveLogger(options);
        const serviceConfig: ReactionServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            workerName: options.workerName,
            batchSize: options.batchSize,
            confirmations: options.confirmations,
            initialBlock: options.initialBlock,
        };
        const { dependencies, dispose } = await resolveDbDependencies<EventReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): EventReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    buildReactionWorkerLockKey("event", serviceConfig.chainId, serviceConfig.workerName),
                ),
            }),
        );
        try {
            const service = new ReactionService<TContext>({
                ...options,
                config: serviceConfig,
                streamType: "event",
                chainCursorRepository: dependencies.chainCursorRepository,
                blocksRepository: dependencies.blocksRepository,
                eventsRepository: dependencies.eventsRepository,
                workerCursorsRepository: dependencies.workerCursorsRepository,
                transactionManager: dependencies.transactionManager,
                logger,
            });

            return new EventReactionWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
        } catch (error) {
            return await disposeAfterError(error, dispose);
        }
    }

    private constructor(
        private readonly serviceConfig: ReactionServiceConfig,
        service: ReactionService<TContext>,
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
            dispose,
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
