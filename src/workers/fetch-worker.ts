import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type {
    FetchWorkerOptions,
    RuntimeDbOptions,
    RuntimeLoggerOptions,
    SingleSourceOptions
} from "../interfaces/options.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import type { FetchServiceConfig } from "../services/fetch-service.js";
import { FetchService } from "../services/fetch-service.js";
import { resolveDbDependencies, resolveLogger, resolveSingleBlockSource } from "../runtime/resolvers.js";
import { PollingWorker } from "./polling-worker.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";

export interface FetchWorkerDatabaseDependencies {
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    eventsRepository: EventsRepository;
    transactionManager: TransactionManager;
}

export type CreateFetchWorkerOptions =
    RuntimeLoggerOptions
    & FetchWorkerOptions
    & SingleSourceOptions
    & RuntimeDbOptions<FetchWorkerDatabaseDependencies>;

export class FetchWorker extends PollingWorker {
    static async create(options: CreateFetchWorkerOptions): Promise<FetchWorker> {
        const logger = resolveLogger(options);
        const source = await resolveSingleBlockSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<FetchWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): FetchWorkerDatabaseDependencies => ({
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
            })
        );
        const serviceConfig: FetchServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            fetchBatchSize: options.fetchBatchSize,
            fetchConcurrency: options.fetchConcurrency,
            fetchClaimTtlMs: options.fetchClaimTtlMs,
            retryMaxAttempts: options.retryMaxAttempts,
            retryBaseDelayMs: options.retryBaseDelayMs,
            retryMaxDelayMs: options.retryMaxDelayMs,
            instanceId: randomUUID(),
        };
        const service = new FetchService(
            serviceConfig,
            source,
            dependencies.blockJobsRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
            dependencies.transactionManager,
            logger,
        );

        return new FetchWorker(serviceConfig, service, logger, dispose);
    }

    private constructor(
        private readonly serviceConfig: FetchServiceConfig,
        private readonly service: FetchService,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `fetch:${String(serviceConfig.chainId)}:${serviceConfig.instanceId}`,
            serviceConfig.delayBetweenTicksMs,
            logger,
            dispose
        );
    }

    protected async tick(): Promise<void> {
        await this.service.execute();
    }

    protected override buildStartLogMeta(): Record<string, unknown> {
        return {
            instanceId: this.serviceConfig.instanceId,
            chainId: this.serviceConfig.chainId,
            fetchBatchSize: this.serviceConfig.fetchBatchSize,
            fetchConcurrency: this.serviceConfig.fetchConcurrency,
            fetchClaimTtlMs: this.serviceConfig.fetchClaimTtlMs,
            retryMaxAttempts: this.serviceConfig.retryMaxAttempts,
            retryBaseDelayMs: this.serviceConfig.retryBaseDelayMs,
            retryMaxDelayMs: this.serviceConfig.retryMaxDelayMs,
        };
    }
}
