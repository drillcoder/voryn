import type { BlockSource } from "./block-source.js";
import type { ChainId } from "../types/chain.js";

export interface RpcNetworkConfig {
    chainId: ChainId;
    rpcUrls: readonly string[];
}

export type SingleChainSourceConfig = {
    chainId?: never;
    source?: never;
    network: RpcNetworkConfig;
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
} | {
    chainId: ChainId;
    source: BlockSource;
    network?: never;
    requestTimeoutMs?: never;
    operationTimeoutMs?: never;
};

export type MultiChainSourceConfig = {
    chainIds?: never;
    source?: never;
    networks: readonly RpcNetworkConfig[];
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
} | {
    chainIds: readonly ChainId[];
    source: BlockSource;
    networks?: never;
    requestTimeoutMs?: never;
    operationTimeoutMs?: never;
};
