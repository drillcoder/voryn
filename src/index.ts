/* istanbul ignore file */

export type {
    AddressHex,
    BlockNumber,
    ChainId,
    DataHex,
    HashHex,
} from "./types/chain.js";
export type { BlockJobStatus, StreamType } from "./types/pipeline.js";

export type { BlockSource } from "./interfaces/block-source.js";
export type { ChainBlock, ChainLog, ChainTransaction, FetchedBlock } from "./interfaces/chain.js";
export type { DbExecutor, DbQueryResult } from "./interfaces/db.js";
export type { LeaderLock } from "./interfaces/leader-lock.js";
export { noopLogger } from "./interfaces/logger.js";
export type { Logger } from "./interfaces/logger.js";
export type {
    BlockDataProgress,
    BlockJobStatusCounts,
    BlockStageMetrics,
    ChainPipelineMetrics,
    FailedBlockMetrics,
    PipelineFreshnessMetrics,
    PipelineMaxLagMetrics,
    PipelineMetricsResult,
    PipelineReactionMetrics,
    PipelineStageMetrics,
} from "./interfaces/metrics.js";
export type {
    BlockJob,
    ChainCursor,
    PipelineBlock,
    PipelineEvent,
    PipelineTransaction,
    RetentionPurgeResult,
    WorkerCursor,
    WorkerCursorPosition,
} from "./interfaces/pipeline.js";
export type {
    BlockJobRecoveryOptions,
    FetchWorkerOptions,
    HeadWorkerOptions,
    MultiSourceOptions,
    PipelineMetricsOptions,
    ReactionWorkerOptions,
    RetentionWorkerOptions,
    RpcConfig,
    RuntimeDbOptions,
    RuntimeLoggerOptions,
    SequencerWorkerOptions,
    SingleSourceOptions,
} from "./interfaces/options.js";
export type {
    EventReactionHandler,
    ReactionContext,
    ReactionHandlerResult,
    TransactionReactionHandler,
} from "./interfaces/reaction.js";
export type { RetryAllFailedBlockJobsResult, RetryFailedBlockJobsResult } from "./interfaces/recovery.js";
export type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "./interfaces/repositories.js";
export type { TransactionManager } from "./interfaces/transaction-manager.js";
export type { WorkerLifecycle, WorkerLifecycleWithFailure } from "./interfaces/worker-lifecycle.js";

export { HeadWorker } from "./workers/head-worker.js";
export type { CreateHeadWorkerOptions, HeadWorkerDatabaseDependencies } from "./workers/head-worker.js";
export { FetchWorker } from "./workers/fetch-worker.js";
export type { CreateFetchWorkerOptions, FetchWorkerDatabaseDependencies } from "./workers/fetch-worker.js";
export { SequencerWorker } from "./workers/sequencer-worker.js";
export type {
    CreateSequencerWorkerOptions,
    SequencerWorkerDatabaseDependencies,
} from "./workers/sequencer-worker.js";
export { RetentionWorker } from "./workers/retention-worker.js";
export type { CreateRetentionWorkerOptions, RetentionWorkerDatabaseDependencies } from "./workers/retention-worker.js";
export { TransactionReactionWorker } from "./workers/transaction-reaction-worker.js";
export type {
    CreateTransactionReactionWorkerOptions,
    TransactionReactionWorkerDatabaseDependencies,
} from "./workers/transaction-reaction-worker.js";
export { EventReactionWorker } from "./workers/event-reaction-worker.js";
export type {
    CreateEventReactionWorkerOptions,
    EventReactionWorkerDatabaseDependencies,
} from "./workers/event-reaction-worker.js";

export { PipelineMetrics } from "./metrics/pipeline-metrics.js";
export type {
    CreatePipelineMetricsOptions,
    PipelineMetricsDatabaseDependencies,
} from "./metrics/pipeline-metrics.js";
export { formatPipelineMetricsPrometheus } from "./metrics/prometheus.js";

export { BlockJobRecovery } from "./recovery/block-job-recovery.js";
export type {
    BlockJobRecoveryDatabaseDependencies,
    CreateBlockJobRecoveryOptions,
} from "./recovery/block-job-recovery.js";

export { ConsoleLogger } from "./loggers/console-logger.js";
export type { ConsoleLoggerOptions, ConsoleLogWriter, LogLevel } from "./loggers/console-logger.js";

export { EthersBlockSource } from "./adapters/ethers-block-source.js";
export type {
    EthersBlockSourceOptions,
    EthersBlockLike,
    EthersLogLike,
    EthersNetworkLike,
    EthersProviderPair,
    EthersProviderLike,
    EthersTransactionLike,
} from "./adapters/ethers-block-source.js";

export { applySqlFileToPostgresDb, validatePostgresSchema } from "./postgres/schema.js";
export type { ApplySqlFileToPostgresDbConfig, ValidatePostgresSchemaConfig } from "./postgres/schema.js";
export { PostgresLeaderLock } from "./postgres/leader-lock.js";
export { PostgresTransactionManager } from "./postgres/transaction-manager.js";

export { PostgresBlockJobsRepository } from "./repositories/postgres/block-jobs-repository.js";
export { PostgresBlocksRepository } from "./repositories/postgres/blocks-repository.js";
export { PostgresChainCursorRepository } from "./repositories/postgres/chain-cursor-repository.js";
export { PostgresEventsRepository } from "./repositories/postgres/events-repository.js";
export { PostgresTransactionsRepository } from "./repositories/postgres/transactions-repository.js";
export { PostgresWorkerCursorsRepository } from "./repositories/postgres/worker-cursors-repository.js";
