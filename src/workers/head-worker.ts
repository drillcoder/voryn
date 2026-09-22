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
import type { SingleChainSourceConfig } from "../interfaces/source-config.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/options.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import type { HeadServiceConfig } from "../services/head-service.js";
import { HeadService } from "../services/head-service.js";
import { HEAD_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import {
    combineDisposers,
    disposeAfterError,
    resolveDbDependencies,
    resolveLogger,
    resolveSingleChainId,
    resolveSingleBlockSource,
} from "../runtime/resolvers.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface HeadWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    eventsRepository: EventsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type HeadWorkerOptions =
    RuntimeLoggerOptions
    & RuntimeDbOptions<HeadWorkerDatabaseDependencies>
    & {
        sourceConfig: SingleChainSourceConfig;
        delayBetweenTicksMs: number;
        depthBlocks: number;
    };

export class HeadWorker extends SingletonPollingWorker {
    static async create(options: HeadWorkerOptions): Promise<HeadWorker> {
        const logger = resolveLogger(options);
        const resolvedSource = await resolveSingleBlockSource(options.sourceConfig, logger);
        const serviceConfig: HeadServiceConfig = {
            chainId: resolveSingleChainId(options.sourceConfig),
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            depthBlocks: options.depthBlocks,
        };
        let dbDispose: (() => Promise<void>) | undefined;
        try {
            const { dependencies, dispose } = await resolveDbDependencies<HeadWorkerDatabaseDependencies>(
                options,
                logger,
                (pool: Pool): HeadWorkerDatabaseDependencies => ({
                    chainCursorRepository: new PostgresChainCursorRepository(pool),
                    blockJobsRepository: new PostgresBlockJobsRepository(pool),
                    blocksRepository: new PostgresBlocksRepository(pool),
                    transactionsRepository: new PostgresTransactionsRepository(pool),
                    eventsRepository: new PostgresEventsRepository(pool),
                    transactionManager: new PostgresTransactionManager(pool),
                    leaderLock: new PostgresLeaderLock(pool, HEAD_WORKER_LOCK_KEY_BASE + BigInt(serviceConfig.chainId)),
                })
            );
            dbDispose = dispose;
            const service = new HeadService(
                serviceConfig,
                resolvedSource.source,
                dependencies.chainCursorRepository,
                dependencies.blockJobsRepository,
                dependencies.blocksRepository,
                dependencies.transactionsRepository,
                dependencies.eventsRepository,
                dependencies.transactionManager,
                logger,
            );

            return new HeadWorker(
                serviceConfig,
                service,
                dependencies.leaderLock,
                logger,
                combineDisposers(dbDispose, resolvedSource.dispose),
            );
        } catch (error) {
            return await disposeAfterError(error, dbDispose, resolvedSource.dispose);
        }
    }

    private constructor(
        private readonly serviceConfig: HeadServiceConfig,
        private readonly service: HeadService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `head:${String(serviceConfig.chainId)}`,
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
            depthBlocks: this.serviceConfig.depthBlocks,
        };
    }
}
