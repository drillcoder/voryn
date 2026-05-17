import type {
    AddressHex,
    BlockNumber,
    ChainId,
    DataHex,
    HashHex,
} from "../types/chain.js";

export interface ChainBlock {
    chainId: ChainId;
    number: BlockNumber;
    hash: HashHex;
    parentHash: HashHex;
    timestamp: number;
}

export interface ChainTransaction {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    index: number;
    hash: HashHex;
    from: AddressHex;
    to: AddressHex | null;
    value: string;
    data: DataHex;
}

export interface ChainLog {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    transactionIndex: number;
    transactionHash: HashHex;
    index: number;
    address: AddressHex;
    topics: HashHex[];
    data: DataHex;
}

export interface FetchedBlock {
    block: ChainBlock;
    transactions: ChainTransaction[];
    logs: ChainLog[];
}
