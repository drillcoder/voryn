import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopWorkerCursorsRepository,
} from "../helpers/pipeline-test-helpers.js";
import { asHash32 } from "../../../src/utils/hex.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const source: BlockSource = {
    getLatestBlockNumber: async (chainId) => chainId * 10,
    getLatestBlock: async (chainId) => ({
        chainId,
        number: chainId * 10,
        hash: HASH,
        parentHash: HASH,
        timestamp: chainId * 100,
    }),
    getBlock: async () => {
        throw new Error("not expected");
    },
    getBlockData: async () => {
        throw new Error("not expected");
    },
};

const config = {
    sourceConfig: {
        chainIds: [7, 8],
        source,
    },
};

test("pipeline metrics create wires aggregate service execution", async () => {
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        ...config,
        overrides: {
            chainCursorRepository: createReadyChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    });

    const snapshot = await metrics.get();

    await metrics.close();

    expect(snapshot.chains.map((chain) => chain.chainId)).toEqual([7, 8]);
    expect(snapshot.chains.map((chain) => chain.latestBlock)).toEqual([70, 80]);
});

test("pipeline metrics returns prometheus text for all configured chains", async () => {
    const metrics = await PipelineMetrics.create({
        logLevel: "error",
        ...config,
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
    expect(text.match(/# TYPE voryn_pipeline_latest_block gauge/g)).toHaveLength(1);
    expect(text).toContain("voryn_pipeline_latest_block{chain_id=\"7\"} 70");
    expect(text).toContain("voryn_pipeline_latest_block{chain_id=\"8\"} 80");
});

test.each([
    [{ sourceConfig: { chainIds: [], source } }, "Pipeline metrics chainIds config must not be empty"],
    [
        { sourceConfig: { chainIds: [7, 7], source } },
        "Pipeline metrics chain id is duplicated: 7",
    ],
    [
        { sourceConfig: { chainIds: [0], source } },
        "Pipeline metrics chain id is invalid: 0",
    ],
    [
        { sourceConfig: { networks: [{ chainId: 7, rpcUrls: [" "] }] } },
        "networks[0].rpcUrls[0] must be a valid HTTP or HTTPS URL",
    ],
])("pipeline metrics rejects invalid source config", async (invalidConfig, expectedError) => {
    await expect(PipelineMetrics.create({
        logLevel: "error",
        ...invalidConfig,
        overrides: {
            chainCursorRepository: createReadyChainCursorRepository(),
            blockJobsRepository: createNoopBlockJobsRepository(),
            blocksRepository: createNoopBlocksRepository(),
            workerCursorsRepository: createNoopWorkerCursorsRepository(),
        },
    })).rejects.toThrow(expectedError);
});

function createReadyChainCursorRepository() {
    return {
        ...createNoopChainCursorRepository(),
        get: async (chainId: number) => ({
            chainId,
            lastEnqueuedBlock: chainId * 10,
            lastCommittedBlock: chainId * 10,
            lastCommittedHash: HASH,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
    };
}
