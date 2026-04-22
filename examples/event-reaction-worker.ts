import type { EventReactionHandler } from "@drillcoder/voryn";
import { ConsoleLogger, EventReactionWorker } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const chainId = 1;
    const workerName = "event-reaction-worker";
    const delayBetweenTicksMs = 1_000;
    const batchSize = 250;
    const lockKey = 40_000_000n;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const config = { chainId, delayBetweenTicksMs, workerName, batchSize };

    const handler: EventReactionHandler = {
        async handle(event): Promise<void> {
            logger.info("event_received", {
                chainId,
                blockNumber: event.blockNumber,
                txHash: event.transactionHash,
                logIndex: event.index,
            });
        },
    };

    const worker = await EventReactionWorker.create({ config, logger, dbUrl, lockKey, handler });

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
