import type { BlockSource } from "../interfaces/block-source.js";
import type { DbExecutor } from "../interfaces/db.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { HeadWorkerOptions } from "../runtime/types.js";
import type { BlockNumber, ChainId } from "../types/chain.js";

export type HeadServiceConfig = HeadWorkerOptions;

export class HeadService {
    constructor(
        private readonly config: HeadServiceConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly blocksRepository: BlocksRepository,
        private readonly transactionsRepository: TransactionsRepository,
        private readonly eventsRepository: EventsRepository,
        private readonly transactionManager: TransactionManager,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async execute(): Promise<void> {
        const { chainId, confirmations, depthBlocks } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);
        const safeHead = latestBlock - confirmations;

        if (safeHead < 0) {
            this.logger.debug("head_waiting_for_safe_head", {
                chainId,
                latestBlock,
                confirmations,
                safeHead,
            });
            return;
        }

        const floor = safeHead - depthBlocks + 1;
        const floorBlock = floor > 0 ? floor : 0;
        const cursorBeforeTx = await this.chainCursorRepository.get(chainId);

        if (cursorBeforeTx === null) {
            await this.initializeCursor(chainId, latestBlock);
            return;
        }

        if (cursorBeforeTx.lastCommittedBlock < floorBlock - 1) {
            await this.rebaseCursorAndEnqueue(chainId, safeHead, floorBlock, depthBlocks);
            return;
        }

        await this.transactionManager.run(async (transaction) => {
            const chainCursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            if (chainCursor.lastCommittedBlock < floorBlock - 1) {
                this.logger.debug("head_enqueue_deferred_until_rebase", {
                    chainId,
                    lastCommittedBlock: chainCursor.lastCommittedBlock,
                    floorBlock,
                });
                return;
            }

            await this.enqueueMissingBlockJobs(
                chainId,
                chainCursor.lastEnqueuedBlock,
                floorBlock,
                safeHead,
                transaction,
            );
        });
    }

    private async initializeCursor(chainId: ChainId, latestBlock: BlockNumber): Promise<void> {
        const latestBlockData = await this.source.getBlockData(chainId, latestBlock);
        await this.chainCursorRepository.insert({
            chainId,
            lastEnqueuedBlock: latestBlock,
            lastCommittedBlock: latestBlock,
            lastCommittedHash: latestBlockData.block.hash,
        });

        this.logger.info("chain_cursor_initialized", {
            chainId,
            latestBlock,
            latestBlockHash: latestBlockData.block.hash,
        });
    }

    private async rebaseCursorAndEnqueue(
        chainId: ChainId,
        safeHead: BlockNumber,
        floorBlock: BlockNumber,
        depthBlocks: number,
    ): Promise<void> {
        const floorData = await this.source.getBlockData(chainId, floorBlock);
        const floorParentHash = floorData.block.parentHash;
        await this.transactionManager.run(async (transaction) => {
            const chainCursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            if (chainCursor.lastCommittedBlock >= floorBlock - 1) {
                await this.enqueueMissingBlockJobs(
                    chainId,
                    chainCursor.lastEnqueuedBlock,
                    floorBlock,
                    safeHead,
                    transaction,
                );
                return;
            }

            const rebaseTo = floorBlock - 1;
            await this.chainCursorRepository.setPositions(
                chainId,
                rebaseTo,
                floorParentHash,
                rebaseTo,
                transaction,
            );
            const oldestBlock = await this.blocksRepository.getOldestBlockNumber(chainId, transaction);
            if (oldestBlock !== null && oldestBlock <= rebaseTo) {
                await this.eventsRepository.deleteBlockNumberRange(chainId, oldestBlock, rebaseTo, transaction);
                await this.transactionsRepository.deleteBlockNumberRange(chainId, oldestBlock, rebaseTo, transaction);
                await this.blocksRepository.deleteBlockNumberRange(chainId, oldestBlock, rebaseTo, transaction);
                await this.blockJobsRepository.deleteBlockNumberRange(chainId, oldestBlock, rebaseTo, transaction);
            }

            this.logger.info("chain_cursor_rebased", {
                chainId,
                safeHead,
                depthBlocks,
                floorBlock,
                rebasedToBlock: rebaseTo,
            });

            await this.enqueueMissingBlockJobs(chainId, rebaseTo, floorBlock, safeHead, transaction);
        });
    }

    private async enqueueMissingBlockJobs(
        chainId: ChainId,
        lastEnqueuedBlock: BlockNumber,
        floorBlock: BlockNumber,
        safeHead: BlockNumber,
        transaction: DbExecutor,
    ): Promise<void> {
        const fromBlock = Math.max(lastEnqueuedBlock + 1, floorBlock);

        if (fromBlock > safeHead) {
            return;
        }

        await this.blockJobsRepository.enqueueRange(chainId, fromBlock, safeHead, transaction);
        await this.chainCursorRepository.setLastEnqueued(chainId, safeHead, transaction);

        this.logger.info("enqueued_block_jobs", {
            chainId,
            fromBlock,
            toBlock: safeHead,
        });
    }
}
