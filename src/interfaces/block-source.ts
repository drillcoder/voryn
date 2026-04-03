import type { BlockNumber, ChainId } from "../types/chain.js";
import type { FetchedBlock } from "./chain.js";

export interface BlockSource {
    getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber>;

    getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock>;
}
