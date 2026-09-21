import { expect, test, vi } from "vitest";

import { Pool } from "pg";
import type { BlockJobsRepository } from "../../../src/interfaces/repositories.js";
import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import { createNoopBlockJobsRepository } from "../helpers/pipeline-test-helpers.js";
import { RpcPoolManager } from "@drillcoder/ethers-rpc-pool";

vi.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: vi.fn(async () => undefined),
}));

interface PipelineMetricsInternals {
    service: {
        blockJobsRepository: BlockJobsRepository;
        source: {
            pool: {
                getSnapshot(): { closed: boolean };
            };
        };
    };
}

test("pipeline metrics merges db defaults with overrides and returns disposer", async () => {
    const blockJobsRepository = createNoopBlockJobsRepository();
    const endSpy = vi.spyOn(Pool.prototype, "end");
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        sourceConfig: {
            networks: [{ chainId: 7, rpcUrls: ["http://127.0.0.1:8545"] }],
        },
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            blockJobsRepository,
        },
    });
    const metricsInternals = metrics as unknown as PipelineMetricsInternals;

    expect(metricsInternals.service.blockJobsRepository).toBe(blockJobsRepository);
    expect(validatePostgresSchema).toHaveBeenCalledTimes(1);

    await metrics.close();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(metricsInternals.service.source.pool.getSnapshot().closed).toBe(true);
    endSpy.mockRestore();
});

test("pipeline metrics closes its RPC pool when database initialization fails", async () => {
    const initializationError = new Error("schema validation failed");
    const closeSpy = vi.spyOn(RpcPoolManager.prototype, "close");
    vi.mocked(validatePostgresSchema).mockRejectedValueOnce(initializationError);

    await expect(PipelineMetrics.create({
        logLevel: "error",
        sourceConfig: {
            networks: [{ chainId: 7, rpcUrls: ["http://127.0.0.1:8545"] }],
        },
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
    })).rejects.toBe(initializationError);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
});
