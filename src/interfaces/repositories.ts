import type { DbExecutor } from "./db.js";
import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";
import type { StreamType } from "../types/pipeline.js";
import type { BlockDataProgress, BlockJobStatusCounts, FailedBlockMetrics } from "./metrics.js";
import type {
    BlockJob,
    ChainCursor,
    PipelineBlock,
    PipelineEvent,
    PipelineTransaction,
    WorkerCursor,
    WorkerCursorPosition,
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

    deleteAtOrBeforeBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface BlocksRepository {
    get(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<PipelineBlock | null>;

    getProgress(chainId: ChainId, transaction?: DbExecutor): Promise<BlockDataProgress | null>;

    insert(block: PipelineBlock, transaction?: DbExecutor): Promise<void>;

    deleteAtOrBeforeBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteByBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface TransactionsRepository {
    listAfterPosition(
        chainId: ChainId,
        maxBlockNumber: BlockNumber,
        afterBlockNumber: BlockNumber,
        afterTransactionIndex: number,
        limit: number,
        transaction?: DbExecutor
    ): Promise<PipelineTransaction[]>;

    insertMany(transactions: PipelineTransaction[], transaction?: DbExecutor): Promise<void>;

    deleteAtOrBeforeBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteByBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
}

export interface EventsRepository {
    listAfterPosition(
        chainId: ChainId,
        maxBlockNumber: BlockNumber,
        afterBlockNumber: BlockNumber,
        afterTransactionIndex: number,
        afterLogIndex: number,
        limit: number,
        transaction?: DbExecutor
    ): Promise<PipelineEvent[]>;

    insertMany(events: PipelineEvent[], transaction?: DbExecutor): Promise<void>;

    deleteAtOrBeforeBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteByBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;

    deleteAfterBlockNumber(chainId: ChainId, blockNumber: BlockNumber, transaction?: DbExecutor): Promise<number>;
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
        position: WorkerCursorPosition,
        transaction?: DbExecutor
    ): Promise<void>;

    advance(
        workerName: string,
        chainId: ChainId,
        streamType: StreamType,
        position: WorkerCursorPosition,
        transaction?: DbExecutor
    ): Promise<void>;
}
