import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { buildTransactionReactionWorker } from "./worker-builder.js";
import type { ReactionWorkerOptions } from "./worker-types.js";
import type { TransactionReactionService } from "../services/transaction-reaction-service.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export interface TransactionReactionWorkerDatabaseDependencies {
    transactionsRepository: CanonicalTransactionsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    leaderLock: LeaderLock;
}

export type CreateTransactionReactionWorkerOptions = ReactionWorkerOptions<
    ReactionWorkerConfig,
    TransactionReactionHandler,
    TransactionReactionWorkerDatabaseDependencies
>;

export class TransactionReactionWorker extends SingletonPollingWorker {
    static async create(options: CreateTransactionReactionWorkerOptions): Promise<TransactionReactionWorker> {
        const { service, leaderLock, dispose } = await buildTransactionReactionWorker(options);
        return new TransactionReactionWorker(options.config, service, leaderLock, dispose, options.logger);
    }

    private constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly service: TransactionReactionService,
        leaderLock: LeaderLock,
        dispose?: () => Promise<void>,
        logger?: Logger,
    ) {
        super(
            `reaction-tx:${String(config.chainId)}:${config.workerName}`,
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
            workerName: this.config.workerName,
            batchSize: this.config.batchSize,
        };
    }
}
