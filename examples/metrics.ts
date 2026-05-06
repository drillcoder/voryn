import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import {
    ConsoleLogger,
    EthersBlockSource,
    PipelineMetricsService,
    PostgresBlockJobsRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
    PostgresWorkerCursorsRepository,
    validatePostgresSchema,
} from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const rpcUrl = "https://rpc.example.org";
    const chainId = 1;
    const confirmations = 0;

    const logger = new ConsoleLogger({ minLevel: "info" });
    const pool = new Pool({ connectionString: dbUrl });

    try {
        await validatePostgresSchema({ pool, logger });

        const service = new PipelineMetricsService(
            { chainId, confirmations },
            new EthersBlockSource({
                provider: new JsonRpcProvider(rpcUrl),
                validateProviderChainId: true,
            }),
            new PostgresChainCursorRepository(pool),
            new PostgresBlockJobsRepository(pool),
            new PostgresRawBlocksRepository(pool),
            new PostgresCanonicalTransactionsRepository(pool),
            new PostgresCanonicalEventsRepository(pool),
            new PostgresWorkerCursorsRepository(pool),
        );
        const metrics = await service.get();

        console.log(JSON.stringify(metrics, stringifyBigint, 2));
    } finally {
        await pool.end();
    }
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

function stringifyBigint(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}
