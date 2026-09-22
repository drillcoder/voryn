import { RpcEndpointDataError, RpcPoolManager } from "@drillcoder/ethers-rpc-pool";
import type { RpcPoolLoggerEvent } from "@drillcoder/ethers-rpc-pool";
import type { Block, Log, TransactionResponse } from "ethers";
import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { RpcNetworkConfig } from "../interfaces/source-config.js";
import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";
import type { ChainBlock, ChainLog, ChainTransaction, FetchedBlock } from "../interfaces/chain.js";
import { asErrorMessage } from "../utils/errors.js";
import { asAddress, asHash32, asHexData } from "../utils/hex.js";

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
    getBlockNumber(): Promise<BlockNumber>;

    getBlock(blockNumber: BlockNumber | "latest", prefetchTxs?: boolean): Promise<EthersBlockLike | null>;

    getTransaction(hash: string): Promise<EthersTransactionLike | null>;

    getLogs(filter: { fromBlock: BlockNumber; toBlock: BlockNumber }): Promise<EthersLogLike[]>;
}

export interface EthersBlockSourceOptions {
    networks: readonly RpcNetworkConfig[];
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
    logger?: Logger;
}

const DEFAULT_RPC_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RPC_OPERATION_TIMEOUT_MS = 60_000;

export class EthersBlockSource implements BlockSource {
    private constructor(
        private readonly pool: RpcPoolManager,
    ) {
    }

    static async create(options: EthersBlockSourceOptions): Promise<EthersBlockSource> {
        await Promise.resolve();
        const {
            networks,
            requestTimeoutMs = DEFAULT_RPC_REQUEST_TIMEOUT_MS,
            operationTimeoutMs = DEFAULT_RPC_OPERATION_TIMEOUT_MS,
            logger = noopLogger,
        } = options;
        if (networks.length === 0) {
            throw new TypeError("Ethers source networks must not be empty");
        }
        const pool = new RpcPoolManager({
            networks,
            requestTimeoutMs,
            operationTimeoutMs,
            logger: (event) => {
                logRpcPoolEvent(logger, event);
            },
        });

        return new EthersBlockSource(pool);
    }

    async close(): Promise<void> {
        await this.pool.close();
    }

    async getLatestBlockNumber(chainId: ChainId): Promise<BlockNumber> {
        return this.pool.executeWithRetry(
            chainId,
            async (provider) => provider.getBlockNumber(),
        );
    }

    async getLatestBlock(chainId: ChainId): Promise<ChainBlock> {
        return this.pool.executeWithRetry(chainId, async (provider) => {
            const block = await provider.getBlock("latest", false);
            return this.mapBlock(chainId, block, "latest");
        });
    }

    async getBlock(chainId: ChainId, blockNumber: BlockNumber): Promise<ChainBlock> {
        return this.pool.executeWithRetry(chainId, async (provider) => {
            const block = await provider.getBlock(blockNumber, false);
            return this.mapBlock(chainId, block, blockNumber);
        });
    }

    async getBlockData(chainId: ChainId, blockNumber: BlockNumber): Promise<FetchedBlock> {
        return this.pool.executeWithRetry(
            chainId,
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
            throw new RpcEndpointDataError(
                `block not found for chain ${String(chainId)} at number ${String(blockNumber)}`
            );
        }

        if (block.hash === null) {
            throw new RpcEndpointDataError(
                `block hash is missing for chain ${String(chainId)} at number ${String(block.number)}`
            );
        }

        if (block.number !== blockNumber) {
            throw new RpcEndpointDataError(
                "block number mismatch for chain "
                + `${String(chainId)}: expected ${String(blockNumber)}, got ${String(block.number)}`
            );
        }

        const blockHash = mapEndpointData(() => asHash32(block.hash));
        const parentHash = mapEndpointData(() => asHash32(block.parentHash));

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

    private mapBlock(
        chainId: ChainId,
        block: EthersBlockLike | null,
        expectedBlock: BlockNumber | "latest",
    ): ChainBlock {
        if (!block) {
            throw new RpcEndpointDataError(
                `block not found for chain ${String(chainId)} at ${String(expectedBlock)}`
            );
        }

        if (expectedBlock !== "latest" && block.number !== expectedBlock) {
            throw new RpcEndpointDataError(
                "block number mismatch for chain "
                + `${String(chainId)}: expected ${String(expectedBlock)}, got ${String(block.number)}`
            );
        }

        if (block.hash === null) {
            throw new RpcEndpointDataError(
                `block hash is missing for chain ${String(chainId)} at number ${String(block.number)}`
            );
        }

        return {
            chainId,
            number: block.number,
            hash: mapEndpointData(() => asHash32(block.hash)),
            parentHash: mapEndpointData(() => asHash32(block.parentHash)),
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
                        throw new RpcEndpointDataError(
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
            throw new RpcEndpointDataError(
                "transaction chain id mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (transaction.blockNumber === null || transaction.blockNumber !== blockNumber) {
            throw new RpcEndpointDataError(
                "transaction block number mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (transaction.blockHash === null || transaction.blockHash !== blockHash) {
            throw new RpcEndpointDataError(
                "transaction block hash mismatch for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        if (!Number.isInteger(transaction.index) || transaction.index < 0) {
            throw new RpcEndpointDataError(
                "transaction index is invalid for chain "
                + `${String(chainId)} block ${String(blockNumber)} transaction ${transaction.hash}`
            );
        }

        return {
            chainId,
            blockNumber,
            blockHash,
            index: transaction.index,
            hash: mapEndpointData(() => asHash32(transaction.hash)),
            to: transaction.to === null ? null : mapEndpointData(() => asAddress(transaction.to)),
            from: mapEndpointData(() => asAddress(transaction.from)),
            data: mapEndpointData(() => asHexData(transaction.data)),
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
                throw new RpcEndpointDataError(
                    `log block number mismatch for chain ${String(chainId)} block ${String(blockNumber)}`
                );
            }

            if (log.blockHash !== blockHash) {
                throw new RpcEndpointDataError(
                    `log block hash mismatch for chain ${String(chainId)} block ${String(blockNumber)}`
                );
            }

            if (!Number.isInteger(log.transactionIndex) || log.transactionIndex < 0) {
                throw new RpcEndpointDataError(
                    `log transaction index is invalid for chain ${String(chainId)} block ${String(blockNumber)}`
                );
            }

            if (!Number.isInteger(log.index) || log.index < 0) {
                throw new RpcEndpointDataError(
                    `log index is invalid for chain ${String(chainId)} block ${String(blockNumber)}`
                );
            }

            return {
                chainId,
                blockNumber,
                blockHash,
                transactionIndex: log.transactionIndex,
                transactionHash: mapEndpointData(() => asHash32(log.transactionHash)),
                address: mapEndpointData(() => asAddress(log.address)),
                data: mapEndpointData(() => asHexData(log.data)),
                topics: log.topics.map((topic) => mapEndpointData(() => asHash32(topic))),
                index: log.index,
            };
        });
    }
}

function mapEndpointData<TResult>(map: () => TResult): TResult {
    try {
        return map();
    } catch (error) {
        throw new RpcEndpointDataError(asErrorMessage(error), { cause: error });
    }
}

function logRpcPoolEvent(logger: Logger, event: RpcPoolLoggerEvent): void {
    const endpoint = {
        chainId: event.chainId,
        endpointNumber: event.endpointNumber,
        hostname: event.hostname,
        timestamp: event.timestamp,
    };

    switch (event.type) {
        case "request":
            logger.debug("rpc_pool_request", {
                ...endpoint,
                method: event.method,
                startedAt: event.startedAt,
            });
            break;
        case "response":
            logger.debug("rpc_pool_response", {
                ...endpoint,
                method: event.method,
                startedAt: event.startedAt,
                finishedAt: event.finishedAt,
                durationMs: event.durationMs,
            });
            break;
        case "error":
            logger.warn("rpc_pool_error", {
                ...endpoint,
                method: event.method,
                startedAt: event.startedAt,
                finishedAt: event.finishedAt,
                durationMs: event.durationMs,
                category: event.category,
                ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus }),
                ...(event.retryAfterMs === undefined ? {} : { retryAfterMs: event.retryAfterMs }),
            });
            break;
        case "switch":
            logger.info("rpc_pool_endpoint_switched", {
                ...endpoint,
                category: event.category,
                nextEndpointNumber: event.nextEndpointNumber,
                nextHostname: event.nextHostname,
            });
            break;
        case "cooldown":
            logger.warn("rpc_pool_endpoint_cooldown_started", {
                ...endpoint,
                category: event.category,
                cooldownUntil: event.cooldownUntil,
            });
            break;
        case "recovery":
            logger.info("rpc_pool_endpoint_recovered", endpoint);
            break;
    }
}
