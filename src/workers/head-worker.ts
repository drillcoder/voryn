import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { BlockJobsRepository, ChainCursorRepository, RawBlocksRepository } from "../interfaces/repositories.js";
import type { HeadWorkerConfig } from "../interfaces/runtime.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { HeadService } from "../services/head-service.js";
import { HEAD_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveEthersSource } from "./worker-resolvers.js";
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "./worker-types.js";
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
    static async create(options: CreateHeadWorkerOptions): Promise<HeadWorker> {
        const source = resolveEthersSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<HeadWorkerDatabaseDependencies>(
            options,
            (pool: Pool): HeadWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                rawBlocksRepository: new PostgresRawBlocksRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(pool, HEAD_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)),
            })
        );
        const service = new HeadService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.transactionManager,
            options.logger
        );

        return new HeadWorker(options.config, service, dependencies.leaderLock, dispose, options.logger);
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
