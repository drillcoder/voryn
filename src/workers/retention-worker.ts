import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { RetentionWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../repositories/postgres/canonical-events-repository.js";
import { PostgresCanonicalTransactionsRepository } from "../repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { RetentionService } from "../services/retention-service.js";
import { RETENTION_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies } from "../runtime/resolvers.js";
import type { WorkerBaseOptions, WorkerDbOptions } from "../runtime/types.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface RetentionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    rawBlocksRepository: RawBlocksRepository;
    canonicalBlocksRepository: CanonicalBlocksRepository;
    canonicalTransactionsRepository: CanonicalTransactionsRepository;
    canonicalEventsRepository: CanonicalEventsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type CreateRetentionWorkerOptions =
    WorkerBaseOptions<RetentionWorkerConfig>
    & WorkerDbOptions<RetentionWorkerDatabaseDependencies>;

export class RetentionWorker extends SingletonPollingWorker {
    static async create(options: CreateRetentionWorkerOptions): Promise<RetentionWorker> {
        const { dependencies, dispose } = await resolveDbDependencies<RetentionWorkerDatabaseDependencies>(
            options,
            (pool: Pool): RetentionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                rawBlocksRepository: new PostgresRawBlocksRepository(pool),
                canonicalBlocksRepository: new PostgresCanonicalBlocksRepository(pool),
                canonicalTransactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
                canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    RETENTION_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)
                ),
            })
        );
        const service = new RetentionService(
            options.config,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.canonicalBlocksRepository,
            dependencies.canonicalTransactionsRepository,
            dependencies.canonicalEventsRepository,
            dependencies.transactionManager,
            options.logger,
        );

        return new RetentionWorker(options.config, service, dependencies.leaderLock, dispose, options.logger);
    }

    private constructor(
        private readonly config: RetentionWorkerConfig,
        private readonly service: RetentionService,
        leaderLock: LeaderLock,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `retention:${String(config.chainId)}`,
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
            retentionDepthBlocks: this.config.retentionDepthBlocks,
        };
    }
}
