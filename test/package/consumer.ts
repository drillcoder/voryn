import { HeadWorker } from "@drillcoder/voryn";
import type { CreateHeadWorkerOptions, HeadWorkerOptions, SingleChainSourceConfig } from "@drillcoder/voryn";

const sourceConfig: SingleChainSourceConfig = {
    network: {
        chainId: 1,
        rpcUrls: ["https://rpc.example.org", "https://fallback-rpc.example.org"],
    },
    requestTimeoutMs: 5_000,
    operationTimeoutMs: 60_000,
};

const options: HeadWorkerOptions = {
    sourceConfig,
    delayBetweenTicksMs: 1_000,
    confirmations: 12,
    depthBlocks: 64,
};

const create = (createOptions: CreateHeadWorkerOptions): Promise<HeadWorker> => HeadWorker.create(createOptions);

void options;
void sourceConfig;
void create;
