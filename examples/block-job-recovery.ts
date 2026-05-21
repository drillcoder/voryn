import { BlockJobRecovery, ConsoleLogger } from "@drillcoder/voryn";

(async () => {
    const config = {
        chainId: 1,
    };
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";

    const recovery = await BlockJobRecovery.create({ config, logger, dbUrl });

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
