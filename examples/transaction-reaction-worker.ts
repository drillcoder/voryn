import type { ReactionHandlerResult, TransactionReactionHandler } from "@drillcoder/voryn";
import { ConsoleLogger, TransactionReactionWorker } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const chainId = 1;
    const workerName = "transaction-reaction-worker";
    const delayBetweenTicksMs = 500;
    const batchSize = 500;
    const skipFlushInterval = 100;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const config = { chainId, delayBetweenTicksMs, workerName, batchSize, skipFlushInterval };

    const handler: TransactionReactionHandler = {
        async handle(transaction): Promise<ReactionHandlerResult> {
            logger.info("transaction_received", {
                chainId,
                blockNumber: transaction.blockNumber,
                hash: transaction.hash,
                transactionIndex: transaction.index,
            });

            return transaction.index === 10 ? 'processed' : 'skipped';
        },
    };

    const worker = await TransactionReactionWorker.create({ config, logger, dbUrl, handler });

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
