import { PipelineMetrics } from "../../../src/metrics/pipeline-metrics.js";
import {
    createNoopBlockJobsRepository,
    createNoopBlocksRepository,
    createNoopChainCursorRepository,
    createNoopWorkerCursorsRepository,
} from "../helpers/pipeline-test-helpers.js";
import { asHash32 } from "../../../src/utils/hex.js";

jest.mock("ethers", () => {
    class FetchRequest {
        readonly url: string;

        constructor(url: string) {
            this.url = url;
        }
    }

    return {
        FetchRequest,
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
        JsonRpcProvider: jest.fn().mockImplementation((request: { url: string }) => ({
            getNetwork: async () => ({ chainId: BigInt(request.url.endsWith("/8") ? 8 : 7) }),
            getBlock: async () => ({
                number: request.url.endsWith("/8") ? 80 : 70,
                hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                parentHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                timestamp: request.url.endsWith("/8") ? 800 : 700,
                transactions: [],
                prefetchedTransactions: [],
            }),
        })),
    };
});

const HASH = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const config = {
    chainIds: [7, 8],
    rpcConfigs: [
        { rpcUrl: "http://127.0.0.1/7" },
        { rpcUrl: "http://127.0.0.1/8" },
    ],
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
    [{ chainIds: [], rpcConfigs: [] }, "Pipeline metrics chainIds config must not be empty"],
    [
        { chainIds: [7, 8], rpcConfigs: [{ rpcUrl: "http://127.0.0.1/7" }] },
        "Pipeline metrics chainIds and rpcConfigs must have the same length",
    ],
    [
        {
            chainIds: [7, 7],
            rpcConfigs: [
                { rpcUrl: "http://127.0.0.1/7" },
                { rpcUrl: "http://127.0.0.1/8" },
            ],
        },
        "Pipeline metrics chain id is duplicated: 7",
    ],
    [
        { chainIds: [0], rpcConfigs: [{ rpcUrl: "http://127.0.0.1/7" }] },
        "Pipeline metrics chain id is invalid: 0",
    ],
    [
        { chainIds: [7], rpcConfigs: [{ rpcUrl: " " }] },
        "Ethers source rpcUrl is empty",
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
