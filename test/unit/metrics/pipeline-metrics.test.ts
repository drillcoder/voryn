import type { PipelineMetricsConfig } from "../../../src/interfaces/metrics.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopWorkerCursorsRepository,
} from "../helpers/pipeline-test-helpers.js";
import { asHash32 } from "../../../src/utils/hex.js";

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const config: PipelineMetricsConfig = {
    chainId: 7,
};

test("pipeline metrics create wires service execution", async () => {
    const getLatestBlock = jest.fn(async () => ({
        chainId: 7,
        number: 20,
        hash: HASH,
        parentHash: HASH,
        timestamp: 200,
    }));
    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getLatestBlock,
        getBlock: async () => ({
            chainId: 7,
            number: 20,
            hash: HASH,
            parentHash: HASH,
            timestamp: 200,
        }),
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        config,
        source,
        overrides: {
            chainCursorRepository: createReadyChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    });

    await metrics.get();

    await metrics.close();

    expect(getLatestBlock).toHaveBeenCalledWith(7);
});

test("pipeline metrics returns prometheus text", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 20,
        getLatestBlock: async () => ({
            chainId: 7,
            number: 20,
            hash: HASH,
            parentHash: HASH,
            timestamp: 200,
        }),
        getBlock: async () => ({
            chainId: 7,
            number: 20,
            hash: HASH,
            parentHash: HASH,
            timestamp: 200,
        }),
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        config,
        source,
        overrides: {
            chainCursorRepository: createReadyChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    });

    const text = await metrics.getPrometheus();

    await metrics.close();

    expect(text).toContain("# TYPE voryn_pipeline_latest_block gauge");
    expect(text).toContain("voryn_pipeline_latest_block{chain_id=\"7\"} 20");
});

function createReadyChainCursorRepository() {
    return {
        ...createNoopChainCursorRepository(),
        get: async () => ({
            chainId: 7,
            lastEnqueuedBlock: 20,
            lastCommittedBlock: 20,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
    };
}
