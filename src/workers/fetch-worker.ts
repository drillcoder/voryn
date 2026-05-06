import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { FetchWorkerConfig } from "../interfaces/runtime.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { FetchService } from "../services/fetch-service.js";
import { resolveDbDependencies, resolveEthersSource } from "./worker-resolvers.js";
import { PollingWorker } from "./polling-worker.js";
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "./worker-types.js";
import type { BlockJobsRepository, RawBlocksRepository } from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { BlockSource } from "../interfaces/block-source.js";

export interface FetchWorkerDatabaseDependencies {
    blockJobsRepository: BlockJobsRepository;
    rawBlocksRepository: RawBlocksRepository;
    transactionManager: TransactionManager;
}

export type CreateFetchWorkerOptions =
    WorkerBaseOptions<FetchWorkerConfig>
    & WorkerSourceOptions<BlockSource>
    & WorkerDbOptions<FetchWorkerDatabaseDependencies>;

export class FetchWorker extends PollingWorker {
    static async create(options: CreateFetchWorkerOptions): Promise<FetchWorker> {
        const source = resolveEthersSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<FetchWorkerDatabaseDependencies>(
            options,
            (pool: Pool): FetchWorkerDatabaseDependencies => ({
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                rawBlocksRepository: new PostgresRawBlocksRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
            })
        );
        const service = new FetchService(
            options.config,
            source,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.transactionManager,
            options.logger
        );

        return new FetchWorker(options.config, service, dispose, options.logger);
    }

    private constructor(
        private readonly config: FetchWorkerConfig,
        private readonly service: FetchService,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `fetch:${String(config.chainId)}:${config.workerId}`,
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
            workerId: this.config.workerId,
            chainId: this.config.chainId,
            fetchBatchSize: this.config.fetchBatchSize,
            fetchClaimTtlMs: this.config.fetchClaimTtlMs,
            retryMaxAttempts: this.config.retryMaxAttempts,
            retryBaseDelayMs: this.config.retryBaseDelayMs,
            retryMaxDelayMs: this.config.retryMaxDelayMs,
        };
    }
}
