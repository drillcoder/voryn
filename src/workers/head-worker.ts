import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { BlockJobsRepository, ChainCursorRepository, RawBlocksRepository } from "../interfaces/repositories.js";
import type { HeadWorkerConfig } from "../interfaces/runtime.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { buildHeadWorker } from "./worker-builder.js";
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "./worker-types.js";
import type { HeadService } from "../services/head-service.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface HeadWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    rawBlocksRepository: RawBlocksRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type CreateHeadWorkerOptions =
    WorkerBaseOptions<HeadWorkerConfig>
    & WorkerSourceOptions<BlockSource>
    & WorkerDbOptions<HeadWorkerDatabaseDependencies>;

export class HeadWorker extends SingletonPollingWorker {
    static create(options: CreateHeadWorkerOptions): HeadWorker {
        const { service, leaderLock, dispose } = buildHeadWorker(options);
        return new HeadWorker(options.config, service, leaderLock, dispose, options.logger);
    }

    private constructor(
        private readonly config: HeadWorkerConfig,
        private readonly service: HeadService,
        leaderLock: LeaderLock,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `head:${String(config.chainId)}`,
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
            confirmations: this.config.confirmations,
            depthBlocks: this.config.depthBlocks,
        };
    }
}
