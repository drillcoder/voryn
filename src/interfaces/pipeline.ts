import type {
    AddressHex,
    BlockNumber,
    ChainId,
    DataHex,
    HashHex,
} from "../types/chain.js";
import type { BlockJobStatus, StreamType } from "../types/pipeline.js";

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

export interface PipelineBlock {
    chainId: ChainId;
    blockNumber: BlockNumber;
    blockHash: HashHex;
    parentHash: HashHex;
    blockTimestamp: number;
    fetchedAt: Date;
}

export interface PipelineTransaction {
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

export interface PipelineEvent {
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

export interface WorkerCursorPosition {
    lastBlockNumber: BlockNumber;
    lastTransactionIndex: number;
    lastLogIndex?: number | null;
}

export interface WorkerCursor {
    workerName: string;
    chainId: ChainId;
    streamType: StreamType;
    position: WorkerCursorPosition;
    updatedAt: Date;
}

export interface RetentionPurgeResult {
    deletedBlockJobs: number;
    deletedBlocks: number;
    deletedTransactions: number;
    deletedEvents: number;
}
