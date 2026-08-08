import type { Block, Log, Provider, TransactionResponse } from "ethers";
import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";
import type { ChainBlock, ChainLog, ChainTransaction, FetchedBlock } from "../interfaces/chain.js";
import { asChainId } from "../utils/chain.js";
import { asErrorMessage } from "../utils/errors.js";
import { asAddress, asHash32, asHexData } from "../utils/hex.js";

export type EthersNetworkLike = Pick<Awaited<ReturnType<Provider["getNetwork"]>>, "chainId">;

export type EthersTransactionLike = Omit<Pick<
    TransactionResponse,
    "chainId" | "blockNumber" | "blockHash" | "index" | "hash" | "from" | "to" | "value" | "data"
>, "chainId"> & {
    chainId: TransactionResponse["chainId"] | null;
};

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

    getBlock(blockNumber: BlockNumber | "latest", prefetchTxs?: boolean): Promise<EthersBlockLike | null>;

    getTransaction(hash: string): Promise<EthersTransactionLike | null>;

    getLogs(filter: { fromBlock: BlockNumber; toBlock: BlockNumber }): Promise<EthersLogLike[]>;
}

export interface EthersProviderPair {
    provider: EthersProviderLike;
    fallbackProvider?: EthersProviderLike;
}

export interface EthersBlockSourceOptions {
    providerPairs: readonly EthersProviderPair[];
    logger?: Logger;
}

export class EthersBlockSource implements BlockSource {
    private constructor(
        private readonly providerPairMap: ReadonlyMap<ChainId, EthersProviderPair>,
        private readonly logger: Logger,
    ) {
    }

    static async create(options: EthersBlockSourceOptions): Promise<EthersBlockSource> {
        const { providerPairs, logger = noopLogger } = options;

        if (providerPairs.length === 0) {
            throw new Error("Ethers source providerPairs must not be empty");
        }

        const providerPairMap = new Map<ChainId, EthersProviderPair>();

        for (const providerPair of providerPairs) {
            const network = await providerPair.provider.getNetwork();
            const chainId = asChainId(network.chainId, "Ethers source chain id");

            if (providerPairMap.has(chainId)) {
                throw new Error(`Ethers source chain id is duplicated: ${String(chainId)}`);
            }

            if (providerPair.fallbackProvider !== undefined) {
                const fallbackNetwork = await providerPair.fallbackProvider.getNetwork();
                const fallbackChainId = asChainId(fallbackNetwork.chainId, "Ethers fallback source chain id");

                if (fallbackChainId !== chainId) {
                    throw new Error(
                        "Ethers fallback source chain id mismatch: "
                        + `expected ${String(chainId)}, got ${String(fallbackChainId)}`
                    );
                }
            }

            providerPairMap.set(chainId, providerPair);
        }

        return new EthersBlockSource(providerPairMap, logger);
    }

    async getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber> {
        return this.executeWithFallback(
            chainId,
            "getLatestBlockNumber",
            {},
            async (provider) => provider.getBlockNumber(),
        );
    }

    async getLatestBlock(chainId: ChainId): Promise<ChainBlock> {
        return this.executeWithFallback(chainId, "getLatestBlock", {}, async (provider) => {
            const block = await provider.getBlock("latest", false);
            return this.mapBlock(chainId, block, "latest");
        });
    }

    async getBlock(chainId: ChainId, blockNumber: BlockNumber): Promise<ChainBlock> {
        return this.executeWithFallback(chainId, "getBlock", { blockNumber }, async (provider) => {
            const block = await provider.getBlock(blockNumber, false);
            return this.mapBlock(chainId, block, blockNumber);
        });
    }

    async getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock> {
        return this.executeWithFallback(
            chainId,
            "getBlockData",
            { blockNumber },
            async (provider) => this.loadBlockData(provider, chainId, blockNumber),
        );
    }

    private async loadBlockData(
        provider: EthersProviderLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
    ): Promise<FetchedBlock> {
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

        const blockHash = asHash32(block.hash);
        const parentHash = asHash32(block.parentHash);

        const transactions = await this.fetchTransactions(provider, chainId, block.number, blockHash, block);
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

    private getProviderPair(chainId: ChainId): EthersProviderPair {
        const providerPair = this.providerPairMap.get(chainId);
        if (providerPair === undefined) {
            throw new Error(`provider not found for chain ${String(chainId)}`);
        }

        return providerPair;
    }

    private async executeWithFallback<TResult>(
        chainId: ChainId,
        operation: string,
        meta: Record<string, unknown>,
        execute: (provider: EthersProviderLike) => Promise<TResult>,
    ): Promise<TResult> {
        const { provider, fallbackProvider } = this.getProviderPair(chainId);

        try {
            return await execute(provider);
        } catch (sourceError) {
            if (fallbackProvider === undefined) {
                throw sourceError;
            }

            this.logger.warn("ethers_source_provider_failed_fallback_started", {
                chainId,
                operation,
                ...meta,
                error: asErrorMessage(sourceError),
            });

            try {
                return await execute(fallbackProvider);
            } catch (fallbackError) {
                throw new AggregateError(
                    [sourceError, fallbackError],
                    `Ethers source ${operation} failed on provider and fallback provider for chain `
                    + `${String(chainId)}: provider: ${asErrorMessage(sourceError)}; `
                    + `fallback: ${asErrorMessage(fallbackError)}`,
                );
            }
        }
    }

    private mapBlock(
        chainId: ChainId,
        block: EthersBlockLike | null,
        expectedBlock: BlockNumber | "latest",
    ): ChainBlock {
        if (!block) {
            throw new Error(
                `block not found for chain ${String(chainId)} at ${String(expectedBlock)}`
            );
        }

        if (expectedBlock !== "latest" && block.number !== expectedBlock) {
            throw new Error(
                "block number mismatch for chain "
                + `${String(chainId)}: expected ${String(expectedBlock)}, got ${String(block.number)}`
            );
        }

        if (block.hash === null) {
            throw new Error(
                `block hash is missing for chain ${String(chainId)} at number ${String(block.number)}`
            );
        }

        return {
            chainId,
            number: block.number,
            hash: asHash32(block.hash),
            parentHash: asHash32(block.parentHash),
            timestamp: block.timestamp,
        };
    }

    private async fetchTransactions(
        provider: EthersProviderLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        block: EthersBlockLike
    ): Promise<ChainTransaction[]> {
        const transactions = await this.resolveTransactions(provider, chainId, blockNumber, block);
        return transactions.map((transaction) => this.mapTransaction(transaction, chainId, blockNumber, blockHash));
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
                    const transaction = await provider.getTransaction(hash);
                    if (!transaction) {
                        throw new Error(
                            "transaction not found for chain "
                            + `${String(chainId)} block ${String(blockNumber)} hash ${hash}`
                        );
                    }

                    return transaction;
                })
            );
        }
    }

    private mapTransaction(
        transaction: EthersTransactionLike,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex
    ): ChainTransaction {
        const transactionChainId = transaction.chainId;
        if (
            transactionChainId !== null
            && transactionChainId !== BigInt(chainId)
        ) {
            throw new Error(
                "transaction chain id mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (transaction.blockNumber === null || transaction.blockNumber !== blockNumber) {
            throw new Error(
                "transaction block number mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (transaction.blockHash === null || transaction.blockHash !== blockHash) {
            throw new Error(
                "transaction block hash mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (!Number.isInteger(transaction.index) || transaction.index < 0) {
            throw new Error(
                "transaction index is invalid for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        return {
            chainId,
            blockNumber,
            blockHash,
            index: transaction.index,
            hash: asHash32(transaction.hash),
            to: transaction.to === null ? null : asAddress(transaction.to),
            from: asAddress(transaction.from),
            data: asHexData(transaction.data),
            value: transaction.value.toString(),
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
                blockHash,
                transactionIndex: log.transactionIndex,
                transactionHash: asHash32(log.transactionHash),
                address: asAddress(log.address),
                data: asHexData(log.data),
                topics: log.topics.map((topic) => asHash32(topic)),
                index: log.index,
            };
        });
    }
}
