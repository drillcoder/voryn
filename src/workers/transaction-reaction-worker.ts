import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { TransactionReactionFilter, TransactionReactionHandler } from "../interfaces/reaction.js";
import type {
    BlocksRepository,
    ChainCursorRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/options.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import type { ReactionServiceConfig } from "../services/reaction-service.js";
import { ReactionService } from "../services/reaction-service.js";
import { disposeAfterError, resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import { ReactionPollingWorker } from "./reaction-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface TransactionReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blocksRepository: BlocksRepository;
    transactionsRepository: TransactionsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    transactionManager: TransactionManager;
    leaderLock: LeaderLock;
}

export type TransactionReactionWorkerOptions =
    RuntimeLoggerOptions
    & ReactionServiceConfig
    & RuntimeDbOptions<TransactionReactionWorkerDatabaseDependencies>
    & { filter: TransactionReactionFilter; handler: TransactionReactionHandler };

export class TransactionReactionWorker extends ReactionPollingWorker {
    static async create(options: TransactionReactionWorkerOptions): Promise<TransactionReactionWorker> {
        const logger = resolveLogger(options);
        const serviceConfig: ReactionServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            workerName: options.workerName,
            batchSize: options.batchSize,
            confirmations: options.confirmations,
            initialBlock: options.initialBlock,
        };
        const { dependencies, dispose } = await resolveDbDependencies<TransactionReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): TransactionReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                transactionManager: new PostgresTransactionManager(pool),
                leaderLock: new PostgresLeaderLock(
                    pool,
                    buildReactionWorkerLockKey("transaction", serviceConfig.chainId, serviceConfig.workerName),
                ),
            }),
        );
        try {
            const service = new ReactionService({
                config: serviceConfig,
                streamType: "transaction",
                filter: options.filter,
                handler: options.handler,
                chainCursorRepository: dependencies.chainCursorRepository,
                blocksRepository: dependencies.blocksRepository,
                transactionsRepository: dependencies.transactionsRepository,
                workerCursorsRepository: dependencies.workerCursorsRepository,
                transactionManager: dependencies.transactionManager,
                logger,
            });

            return new TransactionReactionWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
        } catch (error) {
            return await disposeAfterError(error, dispose);
        }
    }

    private constructor(
        private readonly serviceConfig: ReactionServiceConfig,
        service: ReactionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `reaction-transaction:${String(serviceConfig.chainId)}:${serviceConfig.workerName}`,
            serviceConfig.delayBetweenTicksMs,
            logger,
            leaderLock,
            service,
            dispose,
        );
    }

    protected override buildStartLogMeta(): Record<string, unknown> {
        return {
            chainId: this.serviceConfig.chainId,
            workerName: this.serviceConfig.workerName,
            batchSize: this.serviceConfig.batchSize,
            confirmations: this.serviceConfig.confirmations,
        };
    }
}
