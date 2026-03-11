import type { BlockNumber, ChainId, FetchedBlock, HashHex } from "./chain.js";

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

export interface CanonicalEvent {
    seq: bigint;
    chainId: ChainId;
    blockNumber: BlockNumber;
    txIndex: number;
    logIndex: number;
    payload: unknown;
}

export interface CanonicalTransaction {
    seq: bigint;
    chainId: ChainId;
    blockNumber: BlockNumber;
    txIndex: number;
    txHash: HashHex;
    payload: unknown;
}

export interface WorkerCursor {
    workerName: string;
    chainId: ChainId;
    streamType: StreamType;
    lastSeq: bigint;
    updatedAt: Date;
}
