import type { Block, Log, Provider, TransactionResponse } from "ethers";
import type { BlockSource } from "../interfaces/block-source.js";
import type {
    BlockNumber,
    ChainId,
    ChainLog,
    ChainTransaction,
    FetchedBlock,
    HashHex,
} from "../types/chain.js";
import { asAddressWithContext, asHash32WithContext, asHexDataWithContext } from "../utils/hex.js";

export type EthersNetworkLike = Pick<Awaited<ReturnType<Provider["getNetwork"]>>, "chainId">;

export type EthersTransactionLike = Pick<
    TransactionResponse,
    "blockNumber" | "index" | "hash" | "from" | "to" | "value" | "data"
>;

export type EthersLogLike = Pick<
    Log,
    "blockNumber" | "blockHash" | "transactionHash" | "transactionIndex" | "index" | "address" | "topics" | "data"
>;

export type EthersBlockLike = Pick<
    Block,
    "number" | "hash" | "parentHash" | "timestamp" | "transactions"
> & {
    readonly prefetchedTransactions: EthersTransactionLike[];
};

export interface EthersProviderLike {
    getNetwork(): Promise<EthersNetworkLike>;

    getBlockNumber(): Promise<BlockNumber>;

    getBlock(blockNumber: BlockNumber, prefetchTxs?: boolean): Promise<EthersBlockLike | null>;

    getTransaction(hash: string): Promise<EthersTransactionLike | null>;

    getLogs(filter: { fromBlock: BlockNumber; toBlock: BlockNumber }): Promise<EthersLogLike[]>;
}

export interface EthersBlockSourceDeps {
    providers: ReadonlyMap<ChainId, EthersProviderLike>;
    validateProviderChainId?: boolean;
}

export class EthersBlockSource implements BlockSource {
    private readonly checkedProviderChainIds = new Set<ChainId>();

    constructor(private readonly deps: EthersBlockSourceDeps) {
    }

    async getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber> {
        const provider = await this.getProvider(chainId);
        return provider.getBlockNumber();
    }

    async getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock> {
        const provider = await this.getProvider(chainId);
        const block = await provider.getBlock(blockNumber, true);

        if (!block) {
            throw new Error(
                `block not found for chain ${String(chainId)} at number ${String(blockNumber)}`
            );
        }

        if (block.hash === null) {
            throw new Error(
                `block hash is missing for chain ${String(chainId)} at number ${String(block.number)}`
            );
        }

        if (block.number !== blockNumber) {
            throw new Error(
                "block number mismatch for chain "
                + `${String(chainId)}: expected ${String(blockNumber)}, got ${String(block.number)}`
            );
        }

        const blockHash = asHash32WithContext(block.hash, {
            field: "block.hash",
            chainId,
            blockNumber: block.number,
        });
        const parentHash = asHash32WithContext(block.parentHash, {
            field: "block.parentHash",
            chainId,
            blockNumber: block.number,
        });

        const transactions = await this.fetchTransactions(provider, chainId, block.number, block);
        const logs = await this.fetchLogs(provider, chainId, block.number, blockHash);

        return {
            block: {
                chainId,
                number: block.number,
                hash: blockHash,
                parentHash,
                timestamp: block.timestamp,
            },
            transactions,
            logs,
        };
    }

    private async getProvider(chainId: ChainId): Promise<EthersProviderLike> {
        const provider = this.deps.providers.get(chainId);

        if (!provider) {
            throw new Error(`unsupported chain ${String(chainId)}: provider is not configured`);
        }

        if (!this.deps.validateProviderChainId || this.checkedProviderChainIds.has(chainId)) {
            return provider;
        }

        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(chainId)) {
            throw new Error(
                `provider chain mismatch for chain ${String(chainId)}: got ${network.chainId.toString()}`
            );
        }

        this.checkedProviderChainIds.add(chainId);
        return provider;
    }

    private async fetchTransactions(
        provider: EthersProviderLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
        block: EthersBlockLike
    ): Promise<ChainTransaction[]> {
        const transactions = await this.resolveTransactions(provider, chainId, blockNumber, block);
        return transactions.map((tx) => this.mapTransaction(tx, chainId, blockNumber));
    }

    private async resolveTransactions(
        provider: EthersProviderLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
        block: EthersBlockLike
    ): Promise<EthersTransactionLike[]> {
        try {
            return block.prefetchedTransactions;
        } catch {
            return await Promise.all(
                block.transactions.map(async (hash) => {
                    const tx = await provider.getTransaction(hash);
                    if (!tx) {
                        throw new Error(
                            "transaction not found for chain "
                            + `${String(chainId)} block ${String(blockNumber)} hash ${hash}`
                        );
                    }

                    return tx;
                })
            );
        }
    }

    private mapTransaction(tx: EthersTransactionLike, chainId: ChainId, blockNumber: BlockNumber): ChainTransaction {
        if (tx.blockNumber === null || tx.blockNumber !== blockNumber) {
            throw new Error(
                "transaction block number mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} tx ${tx.hash}`
            );
        }

        if (!Number.isInteger(tx.index) || tx.index < 0) {
            throw new Error(
                `transaction index is invalid for chain ${String(chainId)} block ${String(blockNumber)} tx ${tx.hash}`
            );
        }

        return {
            chainId,
            blockNumber,
            hash: asHash32WithContext(tx.hash, { field: "transaction.hash", chainId, blockNumber }),
            index: tx.index,
            from: asAddressWithContext(tx.from, { field: "transaction.from", chainId, blockNumber }),
            to: tx.to === null ? null : asAddressWithContext(tx.to, { field: "transaction.to", chainId, blockNumber }),
            value: tx.value.toString(),
            input: asHexDataWithContext(tx.data, { field: "transaction.data", chainId, blockNumber }),
        };
    }

    private async fetchLogs(
        provider: EthersProviderLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex
    ): Promise<ChainLog[]> {
        const logs = await provider.getLogs({ fromBlock: blockNumber, toBlock: blockNumber });

        return logs.map((log) => {
            if (log.blockNumber !== blockNumber) {
                throw new Error(`log block number mismatch for chain ${String(chainId)} block ${String(blockNumber)}`);
            }

            if (log.blockHash !== blockHash) {
                throw new Error(`log block hash mismatch for chain ${String(chainId)} block ${String(blockNumber)}`);
            }

            if (!Number.isInteger(log.transactionIndex) || log.transactionIndex < 0) {
                throw new Error(
                    `log transaction index is invalid for chain ${String(chainId)} block ${String(blockNumber)}`
                );
            }

            if (!Number.isInteger(log.index) || log.index < 0) {
                throw new Error(`log index is invalid for chain ${String(chainId)} block ${String(blockNumber)}`);
            }

            return {
                chainId,
                blockNumber,
                txHash: asHash32WithContext(log.transactionHash, {
                    field: "log.transactionHash",
                    chainId,
                    blockNumber,
                }),
                txIndex: log.transactionIndex,
                logIndex: log.index,
                address: asAddressWithContext(log.address, {
                    field: "log.address",
                    chainId,
                    blockNumber,
                }),
                topics: log.topics.map((topic) => asHash32WithContext(topic, {
                    field: "log.topic",
                    chainId,
                    blockNumber,
                })),
                data: asHexDataWithContext(log.data, { field: "log.data", chainId, blockNumber }),
            };
        });
    }
}
