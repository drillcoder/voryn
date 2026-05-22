import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type {
    ChainCursorRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresTransactionsRepository } from "../repositories/postgres/transactions-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { ReactionService } from "../services/reaction-service.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import type { ReactionWorkerOptions } from "../runtime/types.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { buildReactionWorkerLockKey } from "./worker-lock-keys.js";

export interface TransactionReactionWorkerDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    transactionsRepository: TransactionsRepository;
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
        const logger = resolveLogger(options);
        const { dependencies, dispose } = await resolveDbDependencies<TransactionReactionWorkerDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): TransactionReactionWorkerDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                transactionsRepository: new PostgresTransactionsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
                leaderLock: new PostgresLeaderLock(pool, buildReactionWorkerLockKey("transaction", options.config)),
            })
        );
        const service = new ReactionService({
            config: options.config,
            streamType: "transaction",
            handler: options.handler,
            chainCursorRepository: dependencies.chainCursorRepository,
            transactionsRepository: dependencies.transactionsRepository,
            workerCursorsRepository: dependencies.workerCursorsRepository,
            logger,
        });

        return new TransactionReactionWorker(options.config, service, dependencies.leaderLock, logger, dispose);
    }

    private constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly service: ReactionService,
        leaderLock: LeaderLock,
        logger: Logger,
        dispose?: () => Promise<void>,
    ) {
        super(
            `reaction-transaction:${String(config.chainId)}:${config.workerName}`,
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
            workerName: this.config.workerName,
            batchSize: this.config.batchSize,
        };
    }
}
