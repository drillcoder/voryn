import type { CreateEventReactionWorkerOptions, EventReactionHandler, ReactionHandlerResult } from "@drillcoder/voryn";
import { EventReactionWorker } from "@drillcoder/voryn";

(async () => {
    const handler: EventReactionHandler = async (event): Promise<ReactionHandlerResult> => {
        console.info("event_received", {
            chainId: event.chainId,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.index,
        });

        return event.index === 10 ? "processed" : "skipped";
    };
    const options: CreateEventReactionWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
        delayBetweenTicksMs: 500,
        workerName: "event-reaction-worker",
        batchSize: 1000,
        skipFlushInterval: 100,
        handler,
    };

    const worker = await EventReactionWorker.create(options);

    worker.onFailure((error) => {
        console.error(error);
        process.exitCode = 1;
    });

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
