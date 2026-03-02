export type ChainId = number;
export type Hex = `0x${string}`;

export interface ChainBlock {
    chainId: ChainId;
    number: number;
    hash: Hex;
    parentHash: Hex;
    timestamp: number;
}

export interface ChainTransaction {
    chainId: ChainId;
    blockNumber: number;
    hash: Hex;
    index: number;
    from: Hex;
    to: Hex | null;
    value: string;
    input: Hex;
}

export interface ChainLog {
    chainId: ChainId;
    blockNumber: number;
    txHash: Hex;
    txIndex: number;
    logIndex: number;
    address: Hex;
    topics: Hex[];
    data: Hex;
}

export interface FetchedBlock {
    block: ChainBlock;
    transactions: ChainTransaction[];
    logs: ChainLog[];
}
