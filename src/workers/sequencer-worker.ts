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
import { buildSequencerWorker } from "./worker-builder.js";
import type { WorkerBaseOptions, WorkerDbOptions } from "./worker-types.js";
import type { SequencerService } from "../services/sequencer-service.js";
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
    & WorkerDbOptions<SequencerWorkerDatabaseDependencies>;

export class SequencerWorker extends SingletonPollingWorker {
    static create(options: CreateSequencerWorkerOptions): SequencerWorker {
        const { service, leaderLock, dispose } = buildSequencerWorker(options);
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
