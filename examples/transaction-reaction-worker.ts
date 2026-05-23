import type {
    CreateTransactionReactionWorkerOptions,
    ReactionHandlerResult,
    TransactionReactionHandler,
} from "@drillcoder/voryn";
import { TransactionReactionWorker } from "@drillcoder/voryn";

(async () => {
    const handler: TransactionReactionHandler = async (transaction): Promise<ReactionHandlerResult> => {
        console.info("transaction_received", {
            chainId: transaction.chainId,
            blockNumber: transaction.blockNumber,
            hash: transaction.hash,
            transactionIndex: transaction.index,
        });

        return transaction.index === 10 ? "processed" : "skipped";
    };
    const options: CreateTransactionReactionWorkerOptions = {
        chainId: 1,
        delayBetweenTicksMs: 500,
        workerName: "transaction-reaction-worker",
        batchSize: 500,
        skipFlushInterval: 100,
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        handler,
    };

    const worker = await TransactionReactionWorker.create(options);

    const shutdown = async (): Promise<void> => {
        await worker.stop();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await worker.start();
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
