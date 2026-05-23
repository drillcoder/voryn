import type { CreateSequencerWorkerOptions } from "@drillcoder/voryn";
import { SequencerWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateSequencerWorkerOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
        rpcUrl: "https://rpc.example.org",
        delayBetweenTicksMs: 100,
        maxBlocksPerTick: 10,
    };

    const worker = await SequencerWorker.create(options);

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
