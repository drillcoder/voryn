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
    BlocksRepository,
    ChainBlock,
    ChainCursor,
    ChainCursorRepository,
    ChainId,
    ChainLog,
    ChainTransaction,
    ConsoleLoggerOptions,
    ConsoleLogWriter,
    DataHex,
    DbExecutor,
    DbQueryResult,
    EventReactionFilter,
    EventReactionHandler,
    EventReactionWorkerDatabaseDependencies,
    EventReactionWorkerOptions,
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
    PipelineBlock,
    PipelineEvent,
    PipelineMetricsDatabaseDependencies,
    PipelineMetricsOptions,
    PipelineMetricsResult,
    PipelineTransaction,
    RetentionWorkerDatabaseDependencies,
    RetentionWorkerOptions,
    RetryAllFailedBlockJobsResult,
    RetryFailedBlockJobsResult,
    SequencerWorkerDatabaseDependencies,
    SequencerWorkerOptions,
    StreamType,
    TransactionManager,
    TransactionReactionFilter,
    TransactionReactionHandler,
    TransactionReactionWorkerDatabaseDependencies,
    TransactionReactionWorkerOptions,
    TransactionsRepository,
    ValidatePostgresSchemaConfig,
    WorkerCursor,
    WorkerCursorPosition,
    WorkerCursorsRepository,
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
    BlocksRepository: BlocksRepository;
    ChainBlock: ChainBlock;
    ChainCursor: ChainCursor;
    ChainCursorRepository: ChainCursorRepository;
    ChainId: ChainId;
    ChainLog: ChainLog;
    ChainTransaction: ChainTransaction;
    ConsoleLoggerOptions: ConsoleLoggerOptions;
    ConsoleLogWriter: ConsoleLogWriter;
    DataHex: DataHex;
    DbExecutor: DbExecutor;
    DbQueryResult: DbQueryResult;
    EventReactionFilter: EventReactionFilter;
    EventReactionHandler: EventReactionHandler;
    EventReactionWorkerDatabaseDependencies: EventReactionWorkerDatabaseDependencies;
    EventReactionWorkerOptions: EventReactionWorkerOptions;
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
    PipelineBlock: PipelineBlock;
    PipelineEvent: PipelineEvent;
    PipelineMetricsDatabaseDependencies: PipelineMetricsDatabaseDependencies;
    PipelineMetricsOptions: PipelineMetricsOptions;
    PipelineMetricsResult: PipelineMetricsResult;
    PipelineTransaction: PipelineTransaction;
    RetentionWorkerDatabaseDependencies: RetentionWorkerDatabaseDependencies;
    RetentionWorkerOptions: RetentionWorkerOptions;
    RetryAllFailedBlockJobsResult: RetryAllFailedBlockJobsResult;
    RetryFailedBlockJobsResult: RetryFailedBlockJobsResult;
    SequencerWorkerDatabaseDependencies: SequencerWorkerDatabaseDependencies;
    SequencerWorkerOptions: SequencerWorkerOptions;
    StreamType: StreamType;
    TransactionManager: TransactionManager;
    TransactionReactionFilter: TransactionReactionFilter;
    TransactionReactionHandler: TransactionReactionHandler;
    TransactionReactionWorkerDatabaseDependencies: TransactionReactionWorkerDatabaseDependencies;
    TransactionReactionWorkerOptions: TransactionReactionWorkerOptions;
    TransactionsRepository: TransactionsRepository;
    ValidatePostgresSchemaConfig: ValidatePostgresSchemaConfig;
    WorkerCursor: WorkerCursor;
    WorkerCursorPosition: WorkerCursorPosition;
    WorkerCursorsRepository: WorkerCursorsRepository;
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

const blockSource = {} as BlockSource;
type HeadWorkerSourceConfig = HeadWorkerOptions["sourceConfig"];
type PipelineMetricsSourceConfig = PipelineMetricsOptions["sourceConfig"];

const singleRpcPoolOptions: HeadWorkerSourceConfig = {
    network: {
        chainId: 1,
        rpcUrls: ["http://rpc.local", "http://fallback.local"],
    },
};
const multiRpcPoolOptions: PipelineMetricsSourceConfig = {
    networks: [{
        chainId: 1,
        rpcUrls: ["http://rpc.local", "http://fallback.local"],
    }],
};

const customSourceWithNetwork = {
    chainId: 1,
    source: blockSource,
    network: { chainId: 1, rpcUrls: ["http://rpc.local"] },
};
// @ts-expect-error The custom-source branch cannot include network, including through a variable.
const invalidSingleCustomNetwork: HeadWorkerSourceConfig = customSourceWithNetwork;

const rpcNetworkWithTopLevelChainId = {
    network: { chainId: 1, rpcUrls: ["http://rpc.local"] },
    chainId: 1,
};
// @ts-expect-error The RPC branch cannot include a top-level chainId, including through a variable.
const invalidSingleRpcChainId: HeadWorkerSourceConfig = rpcNetworkWithTopLevelChainId;

// @ts-expect-error A custom source cannot be combined with RPC networks.
const invalidMultiSourceFallbackOptions: PipelineMetricsSourceConfig = {
    chainIds: [1],
    source: blockSource,
    networks: [{ chainId: 1, rpcUrls: ["http://rpc.local"] }],
};

const eventFilter: EventReactionFilter = (event) => event.index === 10;
const transactionFilter: TransactionReactionFilter = (transaction) => transaction.index === 10;
const eventHandler: EventReactionHandler = async (event, db, workerName) => {
    await db.query("SELECT $1, $2", [event.index, workerName]);
};
const transactionHandler: TransactionReactionHandler = async (transaction, db) => {
    await db.query("SELECT $1", [transaction.index]);
};
// @ts-expect-error Filters must return a synchronous boolean.
const asyncEventFilter: EventReactionFilter = async () => true;
// @ts-expect-error Filters must return a synchronous boolean.
const asyncTransactionFilter: TransactionReactionFilter = async () => true;
// @ts-expect-error Handler results no longer contain processing statuses.
const oldEventHandler: EventReactionHandler = async () => "processed";
// @ts-expect-error Handler results no longer contain processing statuses.
const oldTransactionHandler: TransactionReactionHandler = async () => "skipped";
declare const validEventOptions: EventReactionWorkerOptions;
declare const validTransactionOptions: TransactionReactionWorkerOptions;
const { filter: removedEventFilter, ...missingEventFilter } = validEventOptions;
const { filter: removedTransactionFilter, ...missingTransactionFilter } = validTransactionOptions;
// @ts-expect-error Event options require a filter.
const invalidEventOptions: EventReactionWorkerOptions = missingEventFilter;
// @ts-expect-error Transaction options require a filter.
const invalidTransactionOptions: TransactionReactionWorkerOptions = missingTransactionFilter;
// @ts-expect-error Skip thresholds are no longer public options.
type EventSkipInterval = EventReactionWorkerOptions["skipFlushInterval"];
// @ts-expect-error Skip thresholds are no longer public options.
type TransactionSkipInterval = TransactionReactionWorkerOptions["skipFlushInterval"];
// @ts-expect-error Removed public context type.
type RemovedReactionContext = publicApi.ReactionContext;
// @ts-expect-error Removed public result type.
type RemovedReactionResult = publicApi.ReactionHandlerResult;

const { handler: removedEventHandler, ...missingEventHandler } = validEventOptions;
const { handler: removedTransactionHandler, ...missingTransactionHandler } = validTransactionOptions;
// @ts-expect-error Event options require a handler.
const invalidEventHandlerOptions: EventReactionWorkerOptions = missingEventHandler;
// @ts-expect-error Transaction options require a handler.
const invalidTransactionHandlerOptions: TransactionReactionWorkerOptions = missingTransactionHandler;
