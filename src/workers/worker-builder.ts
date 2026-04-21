import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "../adapters/ethers-block-source.js";
import { PostgresLeaderLock } from "../postgres/leader-lock.js";
import { PostgresTransactionManager } from "../postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalTransactionsRepository } from "../repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../repositories/postgres/canonical-events-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { EventReactionService } from "../services/event-reaction-service.js";
import { FetchService } from "../services/fetch-service.js";
import { HeadService } from "../services/head-service.js";
import { RetentionService } from "../services/retention-service.js";
import { SequencerService } from "../services/sequencer-service.js";
import { TransactionReactionService } from "../services/transaction-reaction-service.js";
import type { BlockSource } from "../interfaces/block-source.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type {
    CreateEventReactionWorkerOptions,
    EventReactionWorkerDatabaseDependencies,
} from "./event-reaction-worker.js";
import type { CreateFetchWorkerOptions, FetchWorkerDatabaseDependencies } from "./fetch-worker.js";
import type { CreateHeadWorkerOptions, HeadWorkerDatabaseDependencies } from "./head-worker.js";
import type { CreateRetentionWorkerOptions, RetentionWorkerDatabaseDependencies } from "./retention-worker.js";
import type { CreateSequencerWorkerOptions, SequencerWorkerDatabaseDependencies } from "./sequencer-worker.js";
import type {
    CreateTransactionReactionWorkerOptions,
    TransactionReactionWorkerDatabaseDependencies,
} from "./transaction-reaction-worker.js";
import type {
    BuildSingletonWorkerResult,
    BuildWorkerResult,
    ResolveDbDependenciesResult,
    WorkerDbOptions,
    WorkerSourceOptions,
} from "./worker-types.js";

const HEAD_WORKER_LOCK_KEY_BASE = 10_000_000n;
const SEQUENCER_WORKER_LOCK_KEY_BASE = 20_000_000n;
const RETENTION_WORKER_LOCK_KEY_BASE = 30_000_000n;

export function buildHeadWorker(
    options: CreateHeadWorkerOptions
): BuildSingletonWorkerResult<HeadService> {
    const source = resolveEthersSource(options);
    const { dependencies, dispose } = resolveDbDependencies<HeadWorkerDatabaseDependencies>(
        options,
        (pool: Pool): HeadWorkerDatabaseDependencies => ({
            chainCursorRepository: new PostgresChainCursorRepository(pool),
            blockJobsRepository: new PostgresBlockJobsRepository(pool),
            rawBlocksRepository: new PostgresRawBlocksRepository(pool),
            transactionManager: new PostgresTransactionManager(pool),
            leaderLock: new PostgresLeaderLock(pool, HEAD_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)),
        })
    );

    return {
        service: new HeadService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.transactionManager,
            options.logger
        ),
        leaderLock: dependencies.leaderLock,
        dispose,
    };
}

export function buildFetchWorker(
    options: CreateFetchWorkerOptions
): BuildWorkerResult<FetchService> {
    const source = resolveEthersSource(options);
    const { dependencies, dispose } = resolveDbDependencies<FetchWorkerDatabaseDependencies>(
        options,
        (pool: Pool): FetchWorkerDatabaseDependencies => ({
            blockJobsRepository: new PostgresBlockJobsRepository(pool),
            rawBlocksRepository: new PostgresRawBlocksRepository(pool),
            transactionManager: new PostgresTransactionManager(pool),
        })
    );

    return {
        service: new FetchService(
            options.config,
            source,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.transactionManager,
            options.logger
        ),
        dispose,
    };
}

export function buildSequencerWorker(
    options: CreateSequencerWorkerOptions
): BuildSingletonWorkerResult<SequencerService> {
    const { dependencies, dispose } = resolveDbDependencies<SequencerWorkerDatabaseDependencies>(
        options,
        (pool: Pool): SequencerWorkerDatabaseDependencies => ({
            chainCursorRepository: new PostgresChainCursorRepository(pool),
            rawBlocksRepository: new PostgresRawBlocksRepository(pool),
            canonicalBlocksRepository: new PostgresCanonicalBlocksRepository(pool),
            canonicalTransactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
            canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
            blockJobsRepository: new PostgresBlockJobsRepository(pool),
            transactionManager: new PostgresTransactionManager(pool),
            leaderLock: new PostgresLeaderLock(pool, SEQUENCER_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)),
        })
    );

    return {
        service: new SequencerService(
            options.config,
            dependencies.chainCursorRepository,
            dependencies.rawBlocksRepository,
            dependencies.canonicalBlocksRepository,
            dependencies.canonicalTransactionsRepository,
            dependencies.canonicalEventsRepository,
            dependencies.blockJobsRepository,
            dependencies.transactionManager,
            options.logger,
        ),
        leaderLock: dependencies.leaderLock,
        dispose,
    };
}

export function buildRetentionWorker(
    options: CreateRetentionWorkerOptions
): BuildSingletonWorkerResult<RetentionService> {
    const { dependencies, dispose } = resolveDbDependencies<RetentionWorkerDatabaseDependencies>(
        options,
        (pool: Pool): RetentionWorkerDatabaseDependencies => ({
            chainCursorRepository: new PostgresChainCursorRepository(pool),
            blockJobsRepository: new PostgresBlockJobsRepository(pool),
            rawBlocksRepository: new PostgresRawBlocksRepository(pool),
            canonicalBlocksRepository: new PostgresCanonicalBlocksRepository(pool),
            canonicalTransactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
            canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
            transactionManager: new PostgresTransactionManager(pool),
            leaderLock: new PostgresLeaderLock(pool, RETENTION_WORKER_LOCK_KEY_BASE + BigInt(options.config.chainId)),
        })
    );

    return {
        service: new RetentionService(
            options.config,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.canonicalBlocksRepository,
            dependencies.canonicalTransactionsRepository,
            dependencies.canonicalEventsRepository,
            dependencies.transactionManager,
            options.logger,
        ),
        leaderLock: dependencies.leaderLock,
        dispose,
    };
}

export function buildEventReactionWorker(
    options: CreateEventReactionWorkerOptions
): BuildSingletonWorkerResult<EventReactionService> {
    const { dependencies, dispose } = resolveDbDependencies<EventReactionWorkerDatabaseDependencies>(
        options,
        (pool: Pool): EventReactionWorkerDatabaseDependencies => ({
            canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
            workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
            leaderLock: resolveReactionLeaderLock(
                options.overrides?.leaderLock,
                options.lockKey,
                pool,
                "Event reaction worker lock is not configured: pass lockKey or overrides.leaderLock."
            ),
        })
    );

    return {
        service: new EventReactionService(
            options.config,
            options.handler,
            dependencies.canonicalEventsRepository,
            dependencies.workerCursorsRepository,
            options.logger
        ),
        leaderLock: dependencies.leaderLock,
        dispose,
    };
}

export function buildTransactionReactionWorker(
    options: CreateTransactionReactionWorkerOptions
): BuildSingletonWorkerResult<TransactionReactionService> {
    const { dependencies, dispose } = resolveDbDependencies<TransactionReactionWorkerDatabaseDependencies>(
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

    return {
        service: new TransactionReactionService(
            options.config,
            options.handler,
            dependencies.transactionsRepository,
            dependencies.workerCursorsRepository,
            options.logger,
        ),
        leaderLock: dependencies.leaderLock,
        dispose,
    };
}

function resolveEthersSource(options: WorkerSourceOptions<BlockSource>): BlockSource {
    if (options.source !== undefined) {
        return options.source;
    }

    return new EthersBlockSource({
        provider: new JsonRpcProvider(options.rpcUrl),
        validateProviderChainId: true,
    });
}

function resolveDbDependencies<TDependencies extends object>(
    options: WorkerDbOptions<TDependencies>,
    buildDefaults: (pool: Pool) => TDependencies
): ResolveDbDependenciesResult<TDependencies> {
    if (options.dbUrl !== undefined) {
        const pool = new PostgresPool({ connectionString: options.dbUrl });
        const defaults = buildDefaults(pool);

        return {
            dependencies: {
                ...defaults,
                ...options.overrides,
            },
            dispose: async () => {
                await pool.end();
            },
        };
    }

    return {
        dependencies: options.overrides,
    };
}

function resolveReactionLeaderLock(
    override: LeaderLock | undefined,
    lockKey: bigint | undefined,
    pool: Pool,
    lockErrorMessage: string
): LeaderLock {
    if (override !== undefined) {
        return override;
    }

    if (lockKey !== undefined) {
        return new PostgresLeaderLock(pool, lockKey);
    }

    throw new Error(lockErrorMessage);
}
