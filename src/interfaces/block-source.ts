import type { BlockNumber, ChainId } from "../types/chain.js";
import type { ChainBlock, FetchedBlock } from "./chain.js";

export interface BlockSource {
    getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber>;

    getLatestBlock(chainId: ChainId): Promise<ChainBlock>;

    getBlock(chainId: ChainId, blockNumber: BlockNumber): Promise<ChainBlock>;

    getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock>;
}
