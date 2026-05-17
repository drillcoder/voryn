import type {
    AddressHex,
    BlockNumber,
    ChainId,
    DataHex,
    HashHex,
} from "../types/chain.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";
import type { FetchedBlock } from "./chain.js";

export interface ChainCursor {
    chainId: ChainId;
    lastEnqueuedBlock: BlockNumber;
    lastCommittedBlock: BlockNumber;
    lastCommittedHash: HashHex;
    updatedAt: Date;
}

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

export interface RawBlock {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    parentHash: HashHex;
    payload: FetchedBlock;
    fetchedAt: Date;
}

export interface CanonicalEvent {
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
}

export interface CanonicalTransaction {
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
}

export interface WorkerCursor {
    workerName: string;
    chainId: ChainId;
    streamType: StreamType;
    lastSeq: bigint;
    updatedAt: Date;
}

export interface RetentionPurgeResult {
    deletedBlockJobs: number;
    deletedRawBlocks: number;
    deletedCanonicalBlocks: number;
    deletedCanonicalTransactions: number;
    deletedCanonicalEvents: number;
}
