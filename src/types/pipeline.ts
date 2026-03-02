import type { ChainId, FetchedBlock, Hex } from "./chain.js";

export type StreamType = "event" | "tx";

export type BlockJobStatus =
    | "pending"
    | "fetching"
    | "fetched"
    | "committed"
    | "failed";

export interface BlockJob {
    chainId: ChainId;
    blockNumber: number;
    status: BlockJobStatus;
    attempts: number;
    nextRetryAt: Date | null;
    error: string | null;
    claimedAt: Date | null;
    updatedAt: Date;
}

export interface RawBlockEnvelope {
    chainId: ChainId;
    blockNumber: number;
    blockHash: Hex;
    parentHash: Hex;
    payload: FetchedBlock;
    fetchedAt: Date;
}

export interface CanonicalEvent {
    seq: bigint;
    chainId: ChainId;
    blockNumber: number;
    txIndex: number;
    logIndex: number;
    payload: unknown;
}

export interface CanonicalTransaction {
    seq: bigint;
    chainId: ChainId;
    blockNumber: number;
    txIndex: number;
    txHash: Hex;
    payload: unknown;
}

export interface WorkerCursor {
    workerName: string;
    chainId: ChainId;
    streamType: StreamType;
    lastSeq: bigint;
    updatedAt: Date;
}
