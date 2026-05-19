import * as voryn from "../../src/index.js";

test("public entry point exports runtime APIs", () => {
    expect(voryn.EthersBlockSource).toBeDefined();
    expect(voryn.ConsoleLogger).toBeDefined();
    expect(voryn.PipelineMetrics).toBeDefined();
    expect(voryn.applySqlFileToPostgresDb).toBeDefined();
    expect(voryn.validatePostgresSchema).toBeDefined();
    expect(voryn.PostgresBlockJobsRepository).toBeDefined();
    expect(voryn.PostgresBlocksRepository).toBeDefined();
    expect(voryn.PostgresEventsRepository).toBeDefined();
    expect(voryn.PostgresTransactionsRepository).toBeDefined();
    expect(voryn.PostgresChainCursorRepository).toBeDefined();
    expect(voryn.PostgresWorkerCursorsRepository).toBeDefined();
    expect(voryn.PostgresLeaderLock).toBeDefined();
    expect(voryn.PostgresTransactionManager).toBeDefined();
    expect(voryn.HeadWorker).toBeDefined();
    expect(voryn.FetchWorker).toBeDefined();
    expect(voryn.SequencerWorker).toBeDefined();
    expect(voryn.RetentionWorker).toBeDefined();
    expect(voryn.TransactionReactionWorker).toBeDefined();
    expect(voryn.EventReactionWorker).toBeDefined();
});
