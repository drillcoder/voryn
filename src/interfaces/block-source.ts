import type { BlockNumber, ChainId, FetchedBlock } from "../types/chain.js";

export interface BlockSource {
    getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber>;

    getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock>;
}
