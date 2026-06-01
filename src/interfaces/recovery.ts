import type { BlockNumber, ChainId } from "../types/chain.js";

export interface RetryFailedBlockJobsResult {
    chainId: ChainId;
    fromBlock: BlockNumber;
    toBlock: BlockNumber;
    retried: number;
}
