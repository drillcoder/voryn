import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { HeadWorkerConfig } from "../interfaces/runtime.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { HeadService } from "../services/head-service.js";
import { HEAD_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveEthersSource } from "../runtime/resolvers.js";
import type { RuntimeBaseOptions, RuntimeDbOptions, RuntimeSourceOptions } from "../runtime/types.js";
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

export type CreateHeadWorkerOptions =
    RuntimeBaseOptions<HeadWorkerConfig>
    & RuntimeSourceOptions<BlockSource>
    & RuntimeDbOptions<HeadWorkerDatabaseDependencies>;

export class HeadWorker extends SingletonPollingWorker {
    static async create(options: CreateHeadWorkerOptions): Promise<HeadWorker> {
        const source = resolveEthersSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<HeadWorkerDatabaseDependencies>(
            options,
            (pool: Pool): HeadWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(pool, HEAD_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)),
            })
        );
        const service = new HeadService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
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
