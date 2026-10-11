import { EventReactionWorker, HeadWorker, TransactionReactionWorker } from "@drillcoder/voryn";
import type {
    EventReactionWorkerDatabaseDependencies,
    EventReactionWorkerOptions,
    HeadWorkerOptions,
    TransactionReactionWorkerDatabaseDependencies,
    TransactionReactionWorkerOptions,
} from "@drillcoder/voryn";

const options: HeadWorkerOptions = {
    sourceConfig: {
        network: {
            chainId: 1,
            rpcUrls: ["https://rpc.example.org", "https://fallback-rpc.example.org"],
        },
        requestTimeoutMs: 5_000,
        operationTimeoutMs: 60_000,
    },
    delayBetweenTicksMs: 1_000,
    depthBlocks: 64,
    initialBlock: 10,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
};

const create = (createOptions: HeadWorkerOptions): Promise<HeadWorker> => HeadWorker.create(createOptions);

const eventReactionOptions: EventReactionWorkerOptions = {
    chainId: 1,
    workerName: "events",
    delayBetweenTicksMs: 1_000,
    batchSize: 100,
    skipFlushInterval: 10,
    confirmations: 12,
    initialBlock: 10,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    handler: async () => "processed",
};
const transactionReactionOptions: TransactionReactionWorkerOptions = {
    chainId: 1,
    workerName: "transactions",
    delayBetweenTicksMs: 1_000,
    batchSize: 100,
    skipFlushInterval: 10,
    confirmations: 24,
    initialBlock: 10,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    handler: async () => "processed",
};

const createEventReaction = (
    createOptions: EventReactionWorkerOptions,
): Promise<EventReactionWorker> => EventReactionWorker.create(createOptions);
const createTransactionReaction = (
    createOptions: TransactionReactionWorkerOptions,
): Promise<TransactionReactionWorker> => TransactionReactionWorker.create(createOptions);

const withEventOverrides = (
    overrides: EventReactionWorkerDatabaseDependencies,
): EventReactionWorkerOptions => ({
    ...eventReactionOptions, dbUrl: undefined, overrides,
});
const withTransactionOverrides = (
    overrides: TransactionReactionWorkerDatabaseDependencies,
): TransactionReactionWorkerOptions => ({
    ...transactionReactionOptions, dbUrl: undefined, overrides,
});
const eventBlocksRepository = (
    dependencies: EventReactionWorkerDatabaseDependencies,
) => dependencies.blocksRepository;
const transactionBlocksRepository = (
    dependencies: TransactionReactionWorkerDatabaseDependencies,
) => dependencies.blocksRepository;
