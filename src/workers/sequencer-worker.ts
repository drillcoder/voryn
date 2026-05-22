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
import type { SequencerWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { SequencerService } from "../services/sequencer-service.js";
import { SEQUENCER_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveEthersSource, resolveLogger } from "../runtime/resolvers.js";
import type { RuntimeBaseOptions, RuntimeDbOptions, RuntimeSourceOptions } from "../runtime/types.js";
import type { BlockSource } from "../interfaces/block-source.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface SequencerWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    eventsRepository: EventsRepository;
    blockJobsRepository: BlockJobsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type CreateSequencerWorkerOptions =
    RuntimeBaseOptions<SequencerWorkerConfig>
    & RuntimeSourceOptions<BlockSource>
    & RuntimeDbOptions<SequencerWorkerDatabaseDependencies>;

export class SequencerWorker extends SingletonPollingWorker {
    static async create(options: CreateSequencerWorkerOptions): Promise<SequencerWorker> {
        const logger = resolveLogger(options);
        const source = resolveEthersSource(options.config.chainId, options);
        const { dependencies, dispose } = await resolveDbDependencies<SequencerWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): SequencerWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                eventsRepository: new PostgresEventsRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    SEQUENCER_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)
                ),
            })
        );
        const service = new SequencerService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
            dependencies.blockJobsRepository,
            dependencies.transactionManager,
            logger,
        );

        return new SequencerWorker(options.config, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly config: SequencerWorkerConfig,
        private readonly service: SequencerService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `sequencer:${String(config.chainId)}`,
            config.delayBetweenTicksMs,
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
            chainId: this.config.chainId,
            maxBlocksPerTick: this.config.maxBlocksPerTick,
        };
    }
}
