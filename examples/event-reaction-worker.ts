import type { EventReactionHandler, EventReactionWorkerOptions } from "@drillcoder/voryn";
import { EventReactionWorker } from "@drillcoder/voryn";

(async () => {
    const handler: EventReactionHandler = async (event, db, workerName): Promise<void> => {
        console.info("event_received", {
            chainId: event.chainId,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.index,
        });

        await db.query(
            "INSERT INTO reaction_totals (worker_name, total) VALUES ($1, 1) "
            + "ON CONFLICT (worker_name) DO UPDATE SET total = reaction_totals.total + 1",
            [workerName]
        );
    };
    const options: EventReactionWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
        delayBetweenTicksMs: 500,
        workerName: "event-reaction-worker",
        batchSize: 1000,
        confirmations: 12,
        filter: (event) => event.index === 10,
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
