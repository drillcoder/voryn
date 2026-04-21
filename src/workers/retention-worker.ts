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
import { buildRetentionWorker } from "./worker-builder.js";
import type { WorkerBaseOptions, WorkerDbOptions } from "./worker-types.js";
import type { RetentionService } from "../services/retention-service.js";
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
    static create(options: CreateRetentionWorkerOptions): RetentionWorker {
        const { service, leaderLock, dispose } = buildRetentionWorker(options);
        return new RetentionWorker(options.config, service, leaderLock, dispose, options.logger);
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
