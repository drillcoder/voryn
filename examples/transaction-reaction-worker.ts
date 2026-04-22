import type { TransactionReactionHandler } from "@drillcoder/voryn";
import { ConsoleLogger, TransactionReactionWorker } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const chainId = 1;
    const workerName = "transaction-reaction-worker";
    const delayBetweenTicksMs = 1_000;
    const batchSize = 100;
    const lockKey = 50_000_000n;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const config = { chainId, delayBetweenTicksMs, workerName, batchSize };

    const handler: TransactionReactionHandler = {
        async handle(tx): Promise<void> {
            logger.info("transaction_received", {
                chainId,
                blockNumber: tx.blockNumber,
                hash: tx.hash,
                txIndex: tx.index,
            });
        },
    };

    const worker = await TransactionReactionWorker.create({ config, logger, dbUrl, lockKey, handler });

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
