import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { FetchWorkerConfig } from "../interfaces/runtime.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { FetchService } from "../services/fetch-service.js";
import type { FetchServiceConfig } from "../services/fetch-service.js";
import { resolveDbDependencies, resolveEthersSource } from "../runtime/resolvers.js";
import { PollingWorker } from "./polling-worker.js";
import type { RuntimeBaseOptions, RuntimeDbOptions, RuntimeSourceOptions } from "../runtime/types.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { BlockSource } from "../interfaces/block-source.js";

export interface FetchWorkerDatabaseDependencies {
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    eventsRepository: EventsRepository;
    transactionManager: TransactionManager;
}

export type CreateFetchWorkerOptions =
    RuntimeBaseOptions<FetchWorkerConfig>
    & RuntimeSourceOptions<BlockSource>
    & RuntimeDbOptions<FetchWorkerDatabaseDependencies>;

export class FetchWorker extends PollingWorker {
    static async create(options: CreateFetchWorkerOptions): Promise<FetchWorker> {
        const source = resolveEthersSource(options);
        const config: FetchServiceConfig = {
            ...options.config,
            instanceId: randomUUID(),
        };
        const { dependencies, dispose } = await resolveDbDependencies<FetchWorkerDatabaseDependencies>(
            options,
            (pool: Pool): FetchWorkerDatabaseDependencies => ({
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
            })
        );
        const service = new FetchService(
            config,
            source,
            dependencies.blockJobsRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
            dependencies.transactionManager,
            options.logger
        );

        return new FetchWorker(config, service, dispose, options.logger);
    }

    private constructor(
        private readonly config: FetchServiceConfig,
        private readonly service: FetchService,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `fetch:${String(config.chainId)}:${config.instanceId}`,
            config.delayBetweenTicksMs,
            logger ?? noopLogger,
            dispose
        );
    }

    protected async tick(): Promise<void> {
        await this.service.execute();
    }

    protected override buildStartLogMeta(): Record<string, unknown> {
        return {
            instanceId: this.config.instanceId,
            chainId: this.config.chainId,
            fetchBatchSize: this.config.fetchBatchSize,
            fetchClaimTtlMs: this.config.fetchClaimTtlMs,
            retryMaxAttempts: this.config.retryMaxAttempts,
            retryBaseDelayMs: this.config.retryBaseDelayMs,
            retryMaxDelayMs: this.config.retryMaxDelayMs,
        };
    }
}
