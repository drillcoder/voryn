import type { BlockSource } from "./block-source.js";
import type { ChainId } from "../types/chain.js";

export interface EthersSourceChainConfig {
    chainId: ChainId;
    rpcUrl: string;
}

export type EthersSourceConfig =
    | {
        source: BlockSource;
        chain?: never;
    }
    | {
        source?: never;
        chain: EthersSourceChainConfig;
    };

export type EthersSourcesConfig =
    | {
        source: BlockSource;
        chains?: never;
    }
    | {
        source?: never;
        chains: readonly EthersSourceChainConfig[];
    };
