import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { FetchedBlock } from "../../../src/interfaces/chain.js";
import type { LeaderLock } from "../../../src/interfaces/leader-lock.js";
import { asAddress, asHash32, asHexData } from "../../../src/utils/hex.js";

export const CHAIN_ID = 1;
export const FETCH_INSTANCE_ID = "fetch-instance-int";
export const REACTION_WORKER_EVENT = "reaction-event-int";
export const REACTION_WORKER_TRANSACTION = "reaction-transaction-int";

const ADDRESS_A = asAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const ADDRESS_B = asAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ADDRESS_C = asAddress("0xcccccccccccccccccccccccccccccccccccccccc");

export function createLeaderLock(): LeaderLock {
    return {
        async tryAcquire(): Promise<boolean> {
            return true;
        },
        async release(): Promise<void> {
            return undefined;
        },
        onLost(): void {
            return undefined;
        },
    };
}

export function createMapBlockSource(
    latestBlock: number,
    blocks: FetchedBlock[],
): BlockSource {
    const byNumber = new Map<number, FetchedBlock>();
    for (const block of blocks) {
        byNumber.set(block.block.number, block);
    }

    return {
        async getLatestBlockNumber(): Promise<number> {
            return latestBlock;
        },
        async getLatestBlock() {
            const value = byNumber.get(latestBlock);
            if (value === undefined) {
                throw new Error(`missing block ${String(latestBlock)}`);
            }

            return value.block;
        },
        async getBlock(_: number, blockNumber: number) {
            const value = byNumber.get(blockNumber);
            if (value === undefined) {
                throw new Error(`missing block ${String(blockNumber)}`);
            }

            return value.block;
        },
        async getBlockData(_: number, blockNumber: number): Promise<FetchedBlock> {
            const value = byNumber.get(blockNumber);
            if (value === undefined) {
                throw new Error(`missing block ${String(blockNumber)}`);
            }

            return value;
        },
    };
}

export function buildFetchedBlock(
    blockNumber: number,
    parentHash: ReturnType<typeof asHash32>,
    transactionAndLogCount = 1
): FetchedBlock {
    const blockHash = hashFromNumber(blockNumber);
    const transactions = Array.from({ length: transactionAndLogCount }, (_, index) => ({
        chainId: CHAIN_ID,
        blockNumber,
        blockHash,
        index,
        hash: hashFromNumber(blockNumber * 100 + index),
        from: ADDRESS_A,
        to: ADDRESS_B,
        value: String(100 + index),
        data: asHexData("0x1234"),
    }));
    const logs = Array.from({ length: transactionAndLogCount }, (_, index) => ({
        chainId: CHAIN_ID,
        blockNumber,
        blockHash,
        transactionIndex: index,
        transactionHash: transactions[index]?.hash ?? hashFromNumber(blockNumber * 1000 + index),
        index,
        address: ADDRESS_C,
        topics: [hashFromNumber(blockNumber * 10 + index)],
        data: asHexData("0xabcd"),
    }));

    return {
        block: {
            chainId: CHAIN_ID,
            number: blockNumber,
            hash: blockHash,
            parentHash,
            timestamp: 1_700_000_000 + blockNumber,
        },
        transactions,
        logs,
    };
}

export function hashFromNumber(value: number): ReturnType<typeof asHash32> {
    const hex = value.toString(16).padStart(64, "0");
    return asHash32(`0x${hex}`);
}
