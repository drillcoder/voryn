import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { RetentionWorkerOptions, RuntimeDbOptions, RuntimeLoggerOptions } from "../interfaces/options.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import type { RetentionServiceConfig } from "../services/retention-service.js";
import { RetentionService } from "../services/retention-service.js";
import { RETENTION_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface RetentionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    eventsRepository: EventsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type CreateRetentionWorkerOptions =
    RuntimeLoggerOptions
    & RetentionWorkerOptions
    & RuntimeDbOptions<RetentionWorkerDatabaseDependencies>;

export class RetentionWorker extends SingletonPollingWorker {
    static async create(options: CreateRetentionWorkerOptions): Promise<RetentionWorker> {
        const logger = resolveLogger(options);
        const serviceConfig: RetentionServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            retentionDepthBlocks: options.retentionDepthBlocks,
        };
        const { dependencies, dispose } = await resolveDbDependencies<RetentionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): RetentionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    RETENTION_WORKER_LOCK_KEY_BASE + BigInt(serviceConfig.chainId)
                ),
            })
        );
        const service = new RetentionService(
            serviceConfig,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
            dependencies.transactionManager,
            logger,
        );

        return new RetentionWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly serviceConfig: RetentionServiceConfig,
        private readonly service: RetentionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `retention:${String(serviceConfig.chainId)}`,
            serviceConfig.delayBetweenTicksMs,
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
            chainId: this.serviceConfig.chainId,
            retentionDepthBlocks: this.serviceConfig.retentionDepthBlocks,
        };
    }
}
