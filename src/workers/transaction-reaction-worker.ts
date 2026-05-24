import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type {
    ChainCursorRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { ReactionWorkerOptions } from "../runtime/types.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import type { ReactionServiceConfig } from "../services/reaction-service.js";
import { ReactionService } from "../services/reaction-service.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/types.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface TransactionReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    transactionsRepository: TransactionsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    leaderLock: LeaderLock;
}

export type CreateTransactionReactionWorkerOptions =
    RuntimeLoggerOptions
    & ReactionWorkerOptions
    & RuntimeDbOptions<TransactionReactionWorkerDatabaseDependencies>
    & { handler: TransactionReactionHandler };

export class TransactionReactionWorker extends SingletonPollingWorker {
    static async create(options: CreateTransactionReactionWorkerOptions): Promise<TransactionReactionWorker> {
        const logger = resolveLogger(options);
        const serviceConfig: ReactionServiceConfig = {
            chainId: options.chainId,
            delayBetweenTicksMs: options.delayBetweenTicksMs,
            workerName: options.workerName,
            batchSize: options.batchSize,
            skipFlushInterval: options.skipFlushInterval,
        };
        const { dependencies, dispose } = await resolveDbDependencies<TransactionReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): TransactionReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                leaderLock: new PostgresLeaderLock(pool, buildReactionWorkerLockKey("transaction", serviceConfig)),
            })
        );
        const service = new ReactionService({
            config: serviceConfig,
            streamType: "transaction",
            handler: options.handler,
            chainCursorRepository: dependencies.chainCursorRepository,
            transactionsRepository: dependencies.transactionsRepository,
            workerCursorsRepository: dependencies.workerCursorsRepository,
            logger,
        });

        return new TransactionReactionWorker(serviceConfig, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly serviceConfig: ReactionServiceConfig,
        private readonly service: ReactionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `reaction-transaction:${String(serviceConfig.chainId)}:${serviceConfig.workerName}`,
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
            workerName: this.serviceConfig.workerName,
            batchSize: this.serviceConfig.batchSize,
        };
    }
}
