import type { CreateBlockJobRecoveryOptions } from "@drillcoder/voryn";
import { BlockJobRecovery } from "@drillcoder/voryn";

(async () => {
    const options: CreateBlockJobRecoveryOptions = {
        chainId: 1,
        logLevel: "info",
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
    };

    const recovery = await BlockJobRecovery.create(options);

    const blockNumber = 123;
    const fromBlock = 124;
    const toBlock = 130;

    try {
        const singleBlockResult = await recovery.retryFailedBlock(blockNumber);
        const rangeResult = await recovery.retryFailedRange(fromBlock, toBlock);

        console.log(JSON.stringify({ singleBlockResult, rangeResult }, null, 2));
    } finally {
        await recovery.close();
    }
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
