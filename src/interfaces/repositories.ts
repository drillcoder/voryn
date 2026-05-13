import type { DbExecutor } from "./db.js";
import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";
import type { StreamType } from "../types/pipeline.js";
import type { ChainBlock, ChainLog, ChainTransaction } from "./chain.js";
import type { BlockJobStatusCounts, FailedBlockMetrics, RawBlockProgress } from "./metrics.js";
import type {
    BlockJob,
    CanonicalEvent,
    CanonicalTransaction,
    ChainCursor,
    RawBlock,
    WorkerCursor
} from "./pipeline.js";

export interface ChainCursorRepository {
    get(chainId: ChainId, transaction?: DbExecutor): Promise<ChainCursor | null>;

    getForUpdate(chainId: ChainId, transaction: DbExecutor): Promise<ChainCursor | null>;

    insert(cursor: Omit<ChainCursor, "updatedAt">, transaction?: DbExecutor): Promise<void>;

    setLastEnqueued(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<void>;

    setPositions(
        chainId: ChainId,
        lastCommittedBlock: BlockNumber,
        lastCommittedHash: HashHex,
        lastEnqueuedBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<void>;

    advanceLastCommitted(
        chainId: ChainId,
        expectedPreviousBlockNumber: BlockNumber,
        expectedPreviousHash: HashHex,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        transaction?: DbExecutor
    ): Promise<void>;
}

export interface BlockJobsRepository {
    enqueueRange(
        chainId: ChainId,
        fromBlock: BlockNumber,
        toBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<void>;

    get(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<BlockJob | null>;

    claimForFetch(
        chainId: ChainId,
        instanceId: string,
        staleClaimedBefore: Date,
        transaction?: DbExecutor
    ): Promise<BlockJob | null>;

    markFetched(
        chainId: ChainId,
        blockNumber: BlockNumber,
        instanceId: string,
        transaction?: DbExecutor
    ): Promise<void>;

    markFetchFailed(
        chainId: ChainId,
        blockNumber: BlockNumber,
        instanceId: string,
        error: string,
        nextRetryAt: Date | null,
        transaction?: DbExecutor
    ): Promise<void>;

    markCommitted(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<void>;

    getStatusCounts(chainId: ChainId, transaction?: DbExecutor): Promise<BlockJobStatusCounts>;

    listFailedBlocks(chainId: ChainId, limit: number, transaction?: DbExecutor): Promise<FailedBlockMetrics[]>;

    retryFailed(
        chainId: ChainId,
        fromBlock: BlockNumber,
        toBlock: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number>;

    deleteUpToBlock(chainId: ChainId, blockNumberInclusive: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface RawBlocksRepository {
    save(block: RawBlock, transaction?: DbExecutor): Promise<void>;

    get(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<RawBlock | null>;

    getProgress(chainId: ChainId, transaction?: DbExecutor): Promise<RawBlockProgress | null>;

    deleteUpToBlock(chainId: ChainId, blockNumberInclusive: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface CanonicalBlocksRepository {
    insert(block: ChainBlock, transaction?: DbExecutor): Promise<void>;

    get(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<ChainBlock | null>;

    deleteUpToBlock(
        chainId: ChainId,
        blockNumberInclusive: BlockNumber,
        transaction?: DbExecutor
    ): Promise<number>;

    deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface CanonicalTransactionsRepository {
    readFromSeq(
        chainId: ChainId,
        fromSeqExclusive: bigint,
        limit: number,
        transaction?: DbExecutor
    ): Promise<CanonicalTransaction[]>;

    maxSeq(chainId: ChainId, transaction?: DbExecutor): Promise<bigint>;

    insertMany(
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        transactions: ChainTransaction[],
        transaction?: DbExecutor
    ): Promise<void>;

    deleteUpToBlock(chainId: ChainId, blockNumberInclusive: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface CanonicalEventsRepository {
    readFromSeq(
        chainId: ChainId,
        fromSeqExclusive: bigint,
        limit: number,
        transaction?: DbExecutor
    ): Promise<CanonicalEvent[]>;

    maxSeq(chainId: ChainId, transaction?: DbExecutor): Promise<bigint>;

    insertMany(
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        logs: ChainLog[],
        transaction?: DbExecutor
    ): Promise<void>;

    deleteUpToBlock(chainId: ChainId, blockNumberInclusive: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlock(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface WorkerCursorsRepository {
    get(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        transaction?: DbExecutor
    ): Promise<WorkerCursor | null>;

    listByChain(chainId: ChainId, transaction?: DbExecutor): Promise<WorkerCursor[]>;

    insert(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        lastSeq: bigint,
        transaction?: DbExecutor
    ): Promise<void>;

    advance(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        seq: bigint,
        transaction?: DbExecutor
    ): Promise<void>;
}
