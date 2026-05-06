import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { PostgresCanonicalTransactionsRepository } from "../repositories/postgres/canonical-transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { TransactionReactionService } from "../services/transaction-reaction-service.js";
import { resolveDbDependencies, resolveReactionLeaderLock } from "../runtime/resolvers.js";
import type { ReactionWorkerOptions } from "../runtime/types.js";
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
        const { dependencies, dispose } = await resolveDbDependencies<TransactionReactionWorkerDatabaseDependencies>(
            options,
            (pool: Pool): TransactionReactionWorkerDatabaseDependencies => ({
                transactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                leaderLock: resolveReactionLeaderLock(
                    options.overrides?.leaderLock,
                    options.lockKey,
                    pool,
                    "Transaction reaction worker lock is not configured: pass lockKey or overrides.leaderLock."
                ),
            })
        );
        const service = new TransactionReactionService(
            options.config,
            options.handler,
            dependencies.transactionsRepository,
            dependencies.workerCursorsRepository,
            options.logger,
        );

        return new TransactionReactionWorker(options.config, service, dependencies.leaderLock, dispose, options.logger);
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
