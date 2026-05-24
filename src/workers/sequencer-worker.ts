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
import type { SequencerWorkerOptions } from "../runtime/types.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import type { SequencerServiceConfig } from "../services/sequencer-service.js";
import { SequencerService } from "../services/sequencer-service.js";
import { SEQUENCER_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveLogger, resolveSingleBlockSource } from "../runtime/resolvers.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions, SingleSourceOptions } from "../runtime/types.js";
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
    RuntimeLoggerOptions
    & SequencerWorkerOptions
    & SingleSourceOptions
    & RuntimeDbOptions<SequencerWorkerDatabaseDependencies>;

export class SequencerWorker extends SingletonPollingWorker {
    static async create(options: CreateSequencerWorkerOptions): Promise<SequencerWorker> {
        const logger = resolveLogger(options);
        const source = await resolveSingleBlockSource(options);
        const serviceConfig: SequencerServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            maxBlocksPerTick: options.maxBlocksPerTick,
        };
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
                    SEQUENCER_WORKER_LOCK_KEY_BASE + BigInt(serviceConfig.chainId)
                ),
            })
        );
        const service = new SequencerService(
            serviceConfig,
            source,
            dependencies.chainCursorRepository,
            dependencies.blocksRepository,
            dependencies.transactionsRepository,
            dependencies.eventsRepository,
            dependencies.blockJobsRepository,
            dependencies.transactionManager,
            logger,
        );

        return new SequencerWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly serviceConfig: SequencerServiceConfig,
        private readonly service: SequencerService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `sequencer:${String(serviceConfig.chainId)}`,
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
            maxBlocksPerTick: this.serviceConfig.maxBlocksPerTick,
        };
    }
}
