import { EventReactionWorker, HeadWorker, TransactionReactionWorker } from "@drillcoder/voryn";
import type {
    EventReactionWorkerOptions,
    HeadWorkerOptions,
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
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    handler: async () => "processed",
};

void options;
void create;
void EventReactionWorker.create;
void TransactionReactionWorker.create;
void eventReactionOptions;
void transactionReactionOptions;
