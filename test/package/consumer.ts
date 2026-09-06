import { HeadWorker } from "@drillcoder/voryn";
import type { CreateHeadWorkerOptions, HeadWorkerOptions } from "@drillcoder/voryn";

const options: HeadWorkerOptions = {
    chainId: 1,
    delayBetweenTicksMs: 1_000,
    confirmations: 12,
    depthBlocks: 64,
};

const create = (createOptions: CreateHeadWorkerOptions): Promise<HeadWorker> => HeadWorker.create(createOptions);

void options;
void create;
