import type { ChainId, FetchedBlock } from "../types/chain.js";

export interface BlockSource {
    getLatestBlockNumber(chainId: ChainId): Promise<number>;

    getBlockData(chainId: ChainId, blockNumber: number): Promise<FetchedBlock>;
}
