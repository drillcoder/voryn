import { JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import {
    EthersBlockSource,
    PipelineMetricsService,
    PostgresBlockJobsRepository,
    PostgresCanonicalEventsRepository,
    PostgresCanonicalTransactionsRepository,
    PostgresChainCursorRepository,
    PostgresRawBlocksRepository,
    PostgresWorkerCursorsRepository,
    validatePostgresSchema,
} from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling } from "./runtime.js";

async function run(): Promise<void> {
    const logger = createDevLogger();
    const dbUrl = envValue("DATABASE_URL", "");
    const rpcUrl = resolveRpcUrl();
    const chainId = envNumber("VORYN_CHAIN_ID", "0");
    const confirmations = envNumber("VORYN_METRICS_CONFIRMATIONS", envValue("VORYN_HEAD_CONFIRMATIONS", "0"));
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
}

function resolveRpcUrl(): string {
    const explicit = envValue("VORYN_METRICS_RPC_URL", "");
    if (explicit !== "") {
        return explicit;
    }

    const sequencer = envValue("VORYN_SEQUENCER_RPC_URL", "");
    if (sequencer !== "") {
        return sequencer;
    }

    const head = envValue("VORYN_HEAD_RPC_URL", "");
    if (head !== "") {
        return head;
    }

    return envValue("VORYN_FETCH_RPC_URL", "");
}

function stringifyBigint(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}

runWithErrorHandling("metrics", run);
