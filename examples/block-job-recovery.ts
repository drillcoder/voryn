import type { CreateBlockJobRecoveryOptions } from "@drillcoder/voryn";
import { BlockJobRecovery } from "@drillcoder/voryn";

(async () => {
    const options: CreateBlockJobRecoveryOptions = {
        dbUrl: "postgres://user:pass@localhost:5432/voryn",
        logLevel: "info",
        chainId: 1,
    };

    const recovery = await BlockJobRecovery.create(options);

    try {
        const blockNumber = 123;
        const singleBlockResult = await recovery.retryFailedBlock(blockNumber);

        const fromBlock = 124;
        const toBlock = 130;
        const rangeResult = await recovery.retryFailedBlockRange(fromBlock, toBlock);

        const allFailedResult = await recovery.retryAllFailedBlocks();

        console.log(JSON.stringify({ singleBlockResult, rangeResult, allFailedResult }, null, 2));
    } finally {
        await recovery.close();
    }
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
