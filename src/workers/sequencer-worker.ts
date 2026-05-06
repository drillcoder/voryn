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
import type { SequencerWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../repositories/postgres/canonical-events-repository.js";
import { PostgresCanonicalTransactionsRepository } from "../repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { SequencerService } from "../services/sequencer-service.js";
import { SEQUENCER_WORKER_LOCK_KEY_BASE } from "./worker-lock-keys.js";
import { resolveDbDependencies, resolveEthersSource } from "./worker-resolvers.js";
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "./worker-types.js";
import type { BlockSource } from "../interfaces/block-source.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface SequencerWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    rawBlocksRepository: RawBlocksRepository;
    canonicalBlocksRepository: CanonicalBlocksRepository;
    canonicalTransactionsRepository: CanonicalTransactionsRepository;
    canonicalEventsRepository: CanonicalEventsRepository;
    blockJobsRepository: BlockJobsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type CreateSequencerWorkerOptions =
    WorkerBaseOptions<SequencerWorkerConfig>
    & WorkerSourceOptions<BlockSource>
    & WorkerDbOptions<SequencerWorkerDatabaseDependencies>;

export class SequencerWorker extends SingletonPollingWorker {
    static async create(options: CreateSequencerWorkerOptions): Promise<SequencerWorker> {
        const source = resolveEthersSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<SequencerWorkerDatabaseDependencies>(
            options,
            (pool: Pool): SequencerWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                rawBlocksRepository: new PostgresRawBlocksRepository(pool),
                canonicalBlocksRepository: new PostgresCanonicalBlocksRepository(pool),
                canonicalTransactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
                canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
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
            dependencies.rawBlocksRepository,
            dependencies.canonicalBlocksRepository,
            dependencies.canonicalTransactionsRepository,
            dependencies.canonicalEventsRepository,
            dependencies.blockJobsRepository,
            dependencies.transactionManager,
            options.logger,
        );

        return new SequencerWorker(options.config, service, dependencies.leaderLock, dispose, options.logger);
    }

    private constructor(
        private readonly config: SequencerWorkerConfig,
        private readonly service: SequencerService,
        leaderLock: LeaderLock,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `sequencer:${String(config.chainId)}`,
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
            maxBlocksPerTick: this.config.maxBlocksPerTick,
        };
    }
}
