import type { EventReactionHandler, ReactionHandlerResult } from "@drillcoder/voryn";
import { ConsoleLogger, EventReactionWorker } from "@drillcoder/voryn";

(async () => {
    const config = {
        chainId: 1,
        delayBetweenTicksMs: 500,
        workerName: "event-reaction-worker",
        batchSize: 1000,
        skipFlushInterval: 100,
    };
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";

    const handler: EventReactionHandler = {
        async handle(event): Promise<ReactionHandlerResult> {
            logger.info("event_received", {
                chainId: config.chainId,
                blockNumber: event.blockNumber,
                transactionHash: event.transactionHash,
                logIndex: event.index,
            });

            return event.index === 10 ? "processed" : "skipped";
        },
    };

    const worker = await EventReactionWorker.create({ config, logger, dbUrl, handler });

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
