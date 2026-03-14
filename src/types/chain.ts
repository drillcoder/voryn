type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName };

export type ChainId = number;
export type BlockNumber = number;
export type Hex = `0x${string}`;
export type HashHex = Brand<Hex, "hash32">;
export type AddressHex = Brand<Hex, "address20">;
export type DataHex = Brand<Hex, "bytes">;

export interface ChainBlock<TRaw = unknown> {
    chainId: ChainId;
    number: BlockNumber;
    hash: HashHex;
    parentHash: HashHex;
    timestamp: number;
    raw: TRaw;
}

export interface ChainTransaction<TRaw = unknown> {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    index: number;
    hash: HashHex;
    from: AddressHex;
    to: AddressHex | null;
    value: string;
    data: DataHex;
    raw: TRaw;
}

export interface ChainLog<TRaw = unknown> {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    transactionIndex: number;
    transactionHash: HashHex;
    index: number;
    address: AddressHex;
    topics: HashHex[];
    data: DataHex;
    raw: TRaw;
}

export interface FetchedBlock<TBlockRaw = unknown, TTransactionRaw = unknown, TLogRaw = unknown> {
    block: ChainBlock<TBlockRaw>;
    transactions: ChainTransaction<TTransactionRaw>[];
    logs: ChainLog<TLogRaw>[];
}
