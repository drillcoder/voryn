import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";
import type {
    BlockJob,
    CanonicalEvent,
    CanonicalTransaction,
    RawBlockEnvelope,
    StreamType,
    WorkerCursor,
} from "../types/pipeline.js";

export interface ChainCursor {
    chainId: ChainId;
    lastEnqueuedBlock: BlockNumber;
    lastCommittedBlock: BlockNumber;
    lastCommittedHash: HashHex;
    updatedAt: Date;
}

export interface ChainCursorStore {
    get(chainId: ChainId): Promise<ChainCursor>;

    setLastEnqueued(chainId: ChainId, blockNumber: BlockNumber): Promise<void>;
}

export interface BlockJobQueueStore {
    enqueueRange(chainId: ChainId, fromBlock: BlockNumber, toBlock: BlockNumber): Promise<void>;

    claimForFetch(chainId: ChainId, workerId: string): Promise<BlockJob | null>;

    markFetched(chainId: ChainId, blockNumber: BlockNumber): Promise<void>;

    markFetchFailed(chainId: ChainId, blockNumber: BlockNumber, error: string, nextRetryAt: Date | null): Promise<void>;
}

export interface RawBlockStore {
    save(block: RawBlockEnvelope): Promise<void>;

    get(chainId: ChainId, blockNumber: BlockNumber): Promise<RawBlockEnvelope | null>;
}

export interface SequencerCommitStore {
    commitNextBlock(chainId: ChainId, expectedBlockNumber: BlockNumber): Promise<void>;
}

export interface EventStreamStore {
    readFromSeq(chainId: ChainId, fromSeqExclusive: bigint, limit: number): Promise<CanonicalEvent[]>;
}

export interface TransactionStreamStore {
    readFromSeq(chainId: ChainId, fromSeqExclusive: bigint, limit: number): Promise<CanonicalTransaction[]>;
}

export interface WorkerCursorStore {
    get(workerName: string, chainId: ChainId, streamType: StreamType): Promise<WorkerCursor>;

    advance(workerName: string, chainId: ChainId, streamType: StreamType, seq: bigint): Promise<void>;
}

export interface RetentionPurgeResult {
    deletedBlockJobs: number;
    deletedRawBlocks: number;
    deletedCanonicalBlocks: number;
    deletedCanonicalTransactions: number;
    deletedCanonicalEvents: number;
}

export interface RetentionStore {
    purge(chainId: ChainId, depthBlocks: number): Promise<RetentionPurgeResult>;
}
