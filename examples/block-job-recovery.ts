import { BlockJobRecovery, ConsoleLogger } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const chainId = 1;
    const blockNumber = 123;
    const fromBlock = 124;
    const toBlock = 130;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const config = { chainId };

    const recovery = await BlockJobRecovery.create({ config, logger, dbUrl });

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
