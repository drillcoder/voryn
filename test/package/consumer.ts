import { HeadWorker } from "@drillcoder/voryn";
import type { HeadWorkerOptions } from "@drillcoder/voryn";

const options: HeadWorkerOptions = {
    sourceConfig: {
        network: {
            chainId: 1,
            rpcUrls: ["https://rpc.example.org", "https://fallback-rpc.example.org"],
        },
        requestTimeoutMs: 5_000,
        operationTimeoutMs: 60_000,
    },
    delayBetweenTicksMs: 1_000,
    confirmations: 12,
    depthBlocks: 64,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
};

const create = (createOptions: HeadWorkerOptions): Promise<HeadWorker> => HeadWorker.create(createOptions);

void options;
void create;
