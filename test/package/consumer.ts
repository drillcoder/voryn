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

    confirmations: 12,
    initialBlock: 10,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    filter: () => true,
    handler: async () => undefined,
};
const transactionReactionOptions: TransactionReactionWorkerOptions = {
    chainId: 1,
    workerName: "transactions",
    delayBetweenTicksMs: 1_000,
    batchSize: 100,

    confirmations: 24,
    initialBlock: 10,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    filter: () => true,
    handler: async () => undefined,
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

const preparedEvent = () => EventReactionWorker.create({
    ...eventReactionOptions,
    prepare: async (events) => new Set(events.map((event) => event.address)),
    filter: (event, addresses) => (addresses?.has(event.address) ?? false),
    handler: async (event, db, workerName, addresses) => {
        await db.query("SELECT $1, $2", [(addresses?.has(event.address) ?? false), workerName]);
    },
});
const preparedTransaction = () => TransactionReactionWorker.create({
    ...transactionReactionOptions,
    prepare: async (transactions) => new Set(transactions.map((transaction) => transaction.from)),
    filter: (transaction, addresses) => (addresses?.has(transaction.from) ?? false),
    handler: async () => undefined,
});
