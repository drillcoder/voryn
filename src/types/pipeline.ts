import type {
    AddressHex,
    BlockNumber,
    ChainId,
    DataHex,
    FetchedBlock,
    HashHex,
} from "./chain.js";

export type StreamType = "event" | "tx";

export type BlockJobStatus =
    | "pending"
    | "fetching"
    | "fetched"
    | "committed"
    | "failed";

export interface BlockJob {
    chainId: ChainId;
    blockNumber: BlockNumber;
    status: BlockJobStatus;
    attempts: number;
    nextRetryAt: Date | null;
    error: string | null;
    claimedAt: Date | null;
    updatedAt: Date;
}

export interface RawBlockEnvelope {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    parentHash: HashHex;
    payload: FetchedBlock;
    fetchedAt: Date;
}

export interface CanonicalEvent<TRaw = unknown> {
    seq: bigint;
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

export interface CanonicalTransaction<TRaw = unknown> {
    seq: bigint;
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

export interface WorkerCursor {
    workerName: string;
    chainId: ChainId;
    streamType: StreamType;
    lastSeq: bigint;
    updatedAt: Date;
}
