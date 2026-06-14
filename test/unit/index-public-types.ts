import type * as publicApi from "../../src/index.js";
import type {
    AddressHex,
    ApplySqlFileToPostgresDbConfig,
    BlockDataProgress,
    BlockJob,
    BlockJobRecoveryDatabaseDependencies,
    BlockJobRecoveryOptions,
    BlockJobsRepository,
    BlockJobStatus,
    BlockJobStatusCounts,
    BlockNumber,
    BlockSource,
    BlockStageMetrics,
    BlocksRepository,
    ChainBlock,
    ChainCursor,
    ChainCursorRepository,
    ChainId,
    ChainLog,
    ChainPipelineMetrics,
    ChainTransaction,
    ConsoleLoggerOptions,
    ConsoleLogWriter,
    CreateBlockJobRecoveryOptions,
    CreateEventReactionWorkerOptions,
    CreateFetchWorkerOptions,
    CreateHeadWorkerOptions,
    CreatePipelineMetricsOptions,
    CreateRetentionWorkerOptions,
    CreateSequencerWorkerOptions,
    CreateTransactionReactionWorkerOptions,
    DataHex,
    DbExecutor,
    DbQueryResult,
    EthersBlockLike,
    EthersLogLike,
    EthersNetworkLike,
    EthersProviderLike,
    EthersTransactionLike,
    EventReactionHandler,
    EventReactionWorkerDatabaseDependencies,
    EventsRepository,
    FailedBlockMetrics,
    FetchedBlock,
    FetchWorkerDatabaseDependencies,
    FetchWorkerOptions,
    HashHex,
    HeadWorkerDatabaseDependencies,
    HeadWorkerOptions,
    LeaderLock,
    Logger,
    LogLevel,
    MultiSourceOptions,
    PipelineBlock,
    PipelineEvent,
    PipelineFreshnessMetrics,
    PipelineMaxLagMetrics,
    PipelineMetricsDatabaseDependencies,
    PipelineMetricsOptions,
    PipelineMetricsResult,
    PipelineReactionMetrics,
    PipelineStageMetrics,
    PipelineTransaction,
    ReactionContext,
    ReactionHandlerResult,
    ReactionWorkerOptions,
    RetentionPurgeResult,
    RetentionWorkerDatabaseDependencies,
    RetentionWorkerOptions,
    RetryAllFailedBlockJobsResult,
    RetryFailedBlockJobsResult,
    RuntimeDbOptions,
    RuntimeLoggerOptions,
    SequencerWorkerDatabaseDependencies,
    SequencerWorkerOptions,
    SingleSourceOptions,
    StreamType,
    TransactionManager,
    TransactionReactionHandler,
    TransactionReactionWorkerDatabaseDependencies,
    TransactionsRepository,
    ValidatePostgresSchemaConfig,
    WorkerCursor,
    WorkerCursorPosition,
    WorkerCursorsRepository,
    WorkerLifecycle,
} from "../../src/index.js";

type AssertNever<T extends never> = T;
type RuntimePublicApiName = keyof typeof publicApi;
interface PublicApiTypesCompile {
    AddressHex: AddressHex;
    ApplySqlFileToPostgresDbConfig: ApplySqlFileToPostgresDbConfig;
    BlockDataProgress: BlockDataProgress;
    BlockJob: BlockJob;
    BlockJobRecoveryDatabaseDependencies: BlockJobRecoveryDatabaseDependencies;
    BlockJobRecoveryOptions: BlockJobRecoveryOptions;
    BlockJobsRepository: BlockJobsRepository;
    BlockJobStatus: BlockJobStatus;
    BlockJobStatusCounts: BlockJobStatusCounts;
    BlockNumber: BlockNumber;
    BlockSource: BlockSource;
    BlockStageMetrics: BlockStageMetrics;
    BlocksRepository: BlocksRepository;
    ChainBlock: ChainBlock;
    ChainCursor: ChainCursor;
    ChainCursorRepository: ChainCursorRepository;
    ChainId: ChainId;
    ChainLog: ChainLog;
    ChainPipelineMetrics: ChainPipelineMetrics;
    ChainTransaction: ChainTransaction;
    ConsoleLoggerOptions: ConsoleLoggerOptions;
    ConsoleLogWriter: ConsoleLogWriter;
    CreateBlockJobRecoveryOptions: CreateBlockJobRecoveryOptions;
    CreateEventReactionWorkerOptions: CreateEventReactionWorkerOptions;
    CreateFetchWorkerOptions: CreateFetchWorkerOptions;
    CreateHeadWorkerOptions: CreateHeadWorkerOptions;
    CreatePipelineMetricsOptions: CreatePipelineMetricsOptions;
    CreateRetentionWorkerOptions: CreateRetentionWorkerOptions;
    CreateSequencerWorkerOptions: CreateSequencerWorkerOptions;
    CreateTransactionReactionWorkerOptions: CreateTransactionReactionWorkerOptions;
    DataHex: DataHex;
    DbExecutor: DbExecutor;
    DbQueryResult: DbQueryResult;
    EthersBlockLike: EthersBlockLike;
    EthersLogLike: EthersLogLike;
    EthersNetworkLike: EthersNetworkLike;
    EthersProviderLike: EthersProviderLike;
    EthersTransactionLike: EthersTransactionLike;
    EventReactionHandler: EventReactionHandler;
    EventReactionWorkerDatabaseDependencies: EventReactionWorkerDatabaseDependencies;
    EventsRepository: EventsRepository;
    FailedBlockMetrics: FailedBlockMetrics;
    FetchedBlock: FetchedBlock;
    FetchWorkerDatabaseDependencies: FetchWorkerDatabaseDependencies;
    FetchWorkerOptions: FetchWorkerOptions;
    HashHex: HashHex;
    HeadWorkerDatabaseDependencies: HeadWorkerDatabaseDependencies;
    HeadWorkerOptions: HeadWorkerOptions;
    LeaderLock: LeaderLock;
    Logger: Logger;
    LogLevel: LogLevel;
    MultiSourceOptions: MultiSourceOptions;
    PipelineBlock: PipelineBlock;
    PipelineEvent: PipelineEvent;
    PipelineFreshnessMetrics: PipelineFreshnessMetrics;
    PipelineMaxLagMetrics: PipelineMaxLagMetrics;
    PipelineMetricsDatabaseDependencies: PipelineMetricsDatabaseDependencies;
    PipelineMetricsOptions: PipelineMetricsOptions;
    PipelineMetricsResult: PipelineMetricsResult;
    PipelineReactionMetrics: PipelineReactionMetrics;
    PipelineStageMetrics: PipelineStageMetrics;
    PipelineTransaction: PipelineTransaction;
    ReactionContext: ReactionContext;
    ReactionHandlerResult: ReactionHandlerResult;
    ReactionWorkerOptions: ReactionWorkerOptions;
    RetentionPurgeResult: RetentionPurgeResult;
    RetentionWorkerDatabaseDependencies: RetentionWorkerDatabaseDependencies;
    RetentionWorkerOptions: RetentionWorkerOptions;
    RetryAllFailedBlockJobsResult: RetryAllFailedBlockJobsResult;
    RetryFailedBlockJobsResult: RetryFailedBlockJobsResult;
    RuntimeDbOptions: RuntimeDbOptions<Record<string, never>>;
    RuntimeLoggerOptions: RuntimeLoggerOptions;
    SequencerWorkerDatabaseDependencies: SequencerWorkerDatabaseDependencies;
    SequencerWorkerOptions: SequencerWorkerOptions;
    SingleSourceOptions: SingleSourceOptions;
    StreamType: StreamType;
    TransactionManager: TransactionManager;
    TransactionReactionHandler: TransactionReactionHandler;
    TransactionReactionWorkerDatabaseDependencies: TransactionReactionWorkerDatabaseDependencies;
    TransactionsRepository: TransactionsRepository;
    ValidatePostgresSchemaConfig: ValidatePostgresSchemaConfig;
    WorkerCursor: WorkerCursor;
    WorkerCursorPosition: WorkerCursorPosition;
    WorkerCursorsRepository: WorkerCursorsRepository;
    WorkerLifecycle: WorkerLifecycle;
}

type PublicApiTypeOnlyGuard = AssertNever<Extract<keyof PublicApiTypesCompile, RuntimePublicApiName>>;

const addressHexLiteral: AddressHex = "0x90661cE00457cDDFb0d2396E619FeC80cBEF2B2f";
const dataHexLiteral: DataHex = "0x";
const chainTransaction = {} as ChainTransaction;

const comparesAddressWithAddressHex: boolean = chainTransaction.from === addressHexLiteral;
const comparesAddressWithStringLiteral: boolean =
    chainTransaction.from === "0x90661cE00457cDDFb0d2396E619FeC80cBEF2B2f";
const comparesDataWithDataHex: boolean = chainTransaction.data === dataHexLiteral;
const comparesDataWithStringLiteral: boolean = chainTransaction.data === "0x";
