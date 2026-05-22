import type { CreateEventReactionWorkerOptions, EventReactionHandler, ReactionHandlerResult } from "@drillcoder/voryn";
import { EventReactionWorker } from "@drillcoder/voryn";

(async () => {
    const chainId = 1;
    const handler: EventReactionHandler = async (event): Promise<ReactionHandlerResult> => {
        console.info("event_received", {
            chainId,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.index,
        });

        return event.index === 10 ? "processed" : "skipped";
    };
    const options: CreateEventReactionWorkerOptions = {
        config: {
            chainId,
            delayBetweenTicksMs: 500,
            workerName: "event-reaction-worker",
            batchSize: 1000,
            skipFlushInterval: 100,
        },
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        handler,
    };

    const worker = await EventReactionWorker.create(options);

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
