import * as voryn from "../../src/index.js";

test("public entry point exports exact runtime APIs", () => {
    expect(Object.keys(voryn).sort()).toEqual([
        "BlockJobRecovery",
        "ConsoleLogger",
        "EthersBlockSource",
        "EventReactionWorker",
        "FetchWorker",
        "HeadWorker",
        "PipelineMetrics",
        "PostgresBlockJobsRepository",
        "PostgresBlocksRepository",
        "PostgresChainCursorRepository",
        "PostgresEventsRepository",
        "PostgresLeaderLock",
        "PostgresTransactionManager",
        "PostgresTransactionsRepository",
        "PostgresWorkerCursorsRepository",
        "RetentionWorker",
        "SequencerWorker",
        "TransactionReactionWorker",
        "applySqlFileToPostgresDb",
        "formatPipelineMetricsPrometheus",
        "noopLogger",
        "validatePostgresSchema",
    ]);
});
