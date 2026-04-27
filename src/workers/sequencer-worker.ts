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
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "./worker-types.js";
import type { SequencerService } from "../services/sequencer-service.js";
import type { BlockSource } from "../interfaces/block-source.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { buildSequencerWorker } from "./worker-builder.js";

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
        const { service, leaderLock, dispose } = await buildSequencerWorker(options);
        return new SequencerWorker(options.config, service, leaderLock, dispose, options.logger);
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
