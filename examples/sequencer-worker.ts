import type { CreateSequencerWorkerOptions } from "@drillcoder/voryn";
import { SequencerWorker } from "@drillcoder/voryn";

(async () => {
    const options: CreateSequencerWorkerOptions = {
        chainId: 1,
        delayBetweenTicksMs: 100,
        maxBlocksPerTick: 10,
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        rpcUrl: "https://rpc.example.org",
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
