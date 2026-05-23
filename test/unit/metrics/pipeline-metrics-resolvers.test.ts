import { Pool } from "pg";
import type { PipelineMetricsConfig } from "../../../src/interfaces/metrics.js";
import type { BlockJobsRepository } from "../../../src/interfaces/repositories.js";
import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import { createNoopBlockJobsRepository } from "../helpers/pipeline-test-helpers.js";

jest.mock("ethers", () => ({
    isHexString: (value: unknown, length?: number) => (
        typeof value === "string"
        && /^0x[0-9a-fA-F]*$/.test(value)
        && (length === undefined || value.length === 2 + length * 2)
    ),
    isAddress: (value: unknown) => (
        typeof value === "string"
        && /^0x[0-9a-fA-F]{40}$/.test(value)
    ),
    getBytes: (value: unknown) => {
        if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
            throw new Error("invalid bytes");
        }

        return new Uint8Array();
    },
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getNetwork: async () => ({ chainId: 7n }),
    })),
}));

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

const config: PipelineMetricsConfig = {
    chains: [{ chainId: 7, rpcUrl: "http://127.0.0.1:8545" }],
};

interface PipelineMetricsInternals {
    service: {
        blockJobsRepository: BlockJobsRepository;
    };
}

test("pipeline metrics merges db defaults with overrides and returns disposer", async () => {
    const blockJobsRepository = createNoopBlockJobsRepository();
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        config,
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
    endSpy.mockRestore();
});
