import { Pool } from "pg";
import type { PipelineMetricsConfig } from "../../../src/interfaces/metrics.js";
import type { BlockJobsRepository } from "../../../src/interfaces/repositories.js";
import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import { createNoopBlockJobsRepository } from "../helpers/pipeline-test-helpers.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

const config: PipelineMetricsConfig = {
    chainId: 7,
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
        config,
        source: {
            getLatestBlockNumber: async () => 0,
            getLatestBlock: async () => ({
                chainId: 7,
                number: 0,
                hash: HASH,
                parentHash: HASH,
                timestamp: 0,
            }),
            getBlock: async () => ({
                chainId: 7,
                number: 0,
                hash: HASH,
                parentHash: HASH,
                timestamp: 0,
            }),
            getBlockData: async () => {
                throw new Error("not expected");
            },
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
    endSpy.mockRestore();
});
