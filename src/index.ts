export type { AddressHex, BlockNumber, ChainId, DataHex, HashHex } from "./types/chain.js";
export type { BlockJobStatus, StreamType } from "./types/pipeline.js";

export type { ChainBlock, ChainLog, ChainTransaction, FetchedBlock } from "./interfaces/chain.js";
export type { BlockSource } from "./interfaces/block-source.js";

export { HeadWorker } from "./workers/head-worker.js";
export type {
    HeadWorkerDatabaseDependencies,
    HeadWorkerOptions,
} from "./workers/head-worker.js";
export { FetchWorker } from "./workers/fetch-worker.js";
export type {
    FetchWorkerDatabaseDependencies,
    FetchWorkerOptions,
} from "./workers/fetch-worker.js";
export { SequencerWorker } from "./workers/sequencer-worker.js";
export type {
    SequencerWorkerDatabaseDependencies,
    SequencerWorkerOptions,
} from "./workers/sequencer-worker.js";
export { RetentionWorker } from "./workers/retention-worker.js";
export type {
    RetentionWorkerDatabaseDependencies,
    RetentionWorkerOptions,
} from "./workers/retention-worker.js";

export type { EventReactionHandler, ReactionHandlerResult, TransactionReactionHandler } from "./interfaces/reaction.js";
export { TransactionReactionWorker } from "./workers/transaction-reaction-worker.js";
export type {
    TransactionReactionWorkerDatabaseDependencies,
    TransactionReactionWorkerOptions,
} from "./workers/transaction-reaction-worker.js";
export { EventReactionWorker } from "./workers/event-reaction-worker.js";
export type {
    EventReactionWorkerDatabaseDependencies,
    EventReactionWorkerOptions,
} from "./workers/event-reaction-worker.js";

export type {
    BlockDataProgress,
    BlockJobStatusCounts,
    FailedBlockMetrics,
    PipelineMetricsResult,
} from "./interfaces/metrics.js";
export { PipelineMetrics } from "./metrics/pipeline-metrics.js";
export type {
    PipelineMetricsDatabaseDependencies,
    PipelineMetricsOptions,
} from "./metrics/pipeline-metrics.js";

export type { RetryAllFailedBlockJobsResult, RetryFailedBlockJobsResult } from "./interfaces/recovery.js";
export { BlockJobRecovery } from "./recovery/block-job-recovery.js";
export type {
    BlockJobRecoveryDatabaseDependencies,
    BlockJobRecoveryOptions,
} from "./recovery/block-job-recovery.js";

export type { Logger } from "./interfaces/logger.js";
export { noopLogger } from "./interfaces/logger.js";
export { ConsoleLogger } from "./loggers/console-logger.js";
export type { ConsoleLoggerOptions, ConsoleLogWriter, LogLevel } from "./loggers/console-logger.js";

export type { DbExecutor, DbQueryResult } from "./interfaces/db.js";

export { applySqlFileToPostgresDb, validatePostgresSchema } from "./postgres/schema.js";
export type { ApplySqlFileToPostgresDbConfig, ValidatePostgresSchemaConfig } from "./postgres/schema.js";

export type { LeaderLock } from "./interfaces/leader-lock.js";
export { PostgresLeaderLock } from "./postgres/leader-lock.js";

export type { TransactionManager } from "./interfaces/transaction-manager.js";
export { PostgresTransactionManager } from "./postgres/transaction-manager.js";

export type {
    BlockJob,
    ChainCursor,
    PipelineBlock,
    PipelineEvent,
    PipelineTransaction,
    WorkerCursor,
    WorkerCursorPosition,
} from "./interfaces/pipeline.js";
export type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "./interfaces/repositories.js";
export { PostgresBlockJobsRepository } from "./repositories/postgres/block-jobs-repository.js";
export { PostgresBlocksRepository } from "./repositories/postgres/blocks-repository.js";
export { PostgresChainCursorRepository } from "./repositories/postgres/chain-cursor-repository.js";
export { PostgresEventsRepository } from "./repositories/postgres/events-repository.js";
export { PostgresTransactionsRepository } from "./repositories/postgres/transactions-repository.js";
export { PostgresWorkerCursorsRepository } from "./repositories/postgres/worker-cursors-repository.js";
