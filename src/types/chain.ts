type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName };

export type ChainId = number;
export type Hex = `0x${string}`;
export type HashHex = Brand<Hex, "hash32">;
export type AddressHex = Brand<Hex, "address20">;
export type DataHex = Brand<Hex, "bytes">;

export interface ChainBlock {
    chainId: ChainId;
    number: number;
    hash: HashHex;
    parentHash: HashHex;
    timestamp: number;
}

export interface ChainTransaction {
    chainId: ChainId;
    blockNumber: number;
    hash: HashHex;
    index: number;
    from: AddressHex;
    to: AddressHex | null;
    value: string;
    input: DataHex;
}

export interface ChainLog {
    chainId: ChainId;
    blockNumber: number;
    txHash: HashHex;
    txIndex: number;
    logIndex: number;
    address: AddressHex;
    topics: HashHex[];
    data: DataHex;
}

export interface FetchedBlock {
    block: ChainBlock;
    transactions: ChainTransaction[];
    logs: ChainLog[];
}
