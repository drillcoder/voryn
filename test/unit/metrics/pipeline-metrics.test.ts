import type { PipelineMetricsConfig } from "../../../src/interfaces/metrics.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import {
    createNoopBlockJobsRepository,
    createNoopCanonicalEventsRepository,
    createNoopCanonicalTransactionsRepository,
    createNoopChainCursorRepository,
    createNoopRawBlocksRepository,
    createNoopWorkerCursorsRepository,
} from "../helpers/pipeline-test-helpers.js";

const config: PipelineMetricsConfig = {
    chainId: 7,
};

test("pipeline metrics create wires service execution", async () => {
    const getLatestBlockNumber = jest.fn(async () => 20);
    const source: BlockSource = {
        getLatestBlockNumber,
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };
    const metrics = await PipelineMetrics.create({
        config,
        source,
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            rawBlocksRepository: createNoopRawBlocksRepository(),
            canonicalTransactionsRepository: createNoopCanonicalTransactionsRepository(),
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    });

    await metrics.get();

    await metrics.close();

    expect(getLatestBlockNumber).toHaveBeenCalledWith(7);
});

test("pipeline metrics returns prometheus text", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };
    const metrics = await PipelineMetrics.create({
        config,
        source,
        overrides: {
            chainCursorRepository: createNoopChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            rawBlocksRepository: createNoopRawBlocksRepository(),
            canonicalTransactionsRepository: createNoopCanonicalTransactionsRepository(),
            canonicalEventsRepository: createNoopCanonicalEventsRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    });

    const text = await metrics.getPrometheus();

    await metrics.close();

    expect(text).toContain("# TYPE voryn_pipeline_latest_block gauge");
    expect(text).toContain("voryn_pipeline_latest_block{chain_id=\"7\"} 20");
});
