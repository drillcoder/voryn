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
import type { BlockNumber, ChainId } from "../types/chain.js";

export interface HeadServiceConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    depthBlocks: number;
}

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
        const { chainId, depthBlocks } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);

        this.logger.debug("head_latest_block_number_load_completed", {
            chainId,
            latestBlock,
        });

        const floor = latestBlock - depthBlocks + 1;
        const floorBlock = floor > 0 ? floor : 0;
        const cursorBeforeTx = await this.chainCursorRepository.get(chainId);

        this.logger.debug("head_tick_observed", {
            chainId,
            latestBlock,
            depthBlocks,
            floorBlock,
            lastEnqueuedBlock: cursorBeforeTx?.lastEnqueuedBlock ?? null,
            lastCommittedBlock: cursorBeforeTx?.lastCommittedBlock ?? null,
        });

        if (cursorBeforeTx === null) {
            this.logger.debug("head_cursor_initialization_required", {
                chainId,
                latestBlock,
            });
            await this.initializeCursor(chainId, latestBlock);
            return;
        }

        if (cursorBeforeTx.lastCommittedBlock < floorBlock - 1) {
            this.logger.info("head_rebase_required", {
                chainId,
                latestBlock,
                floorBlock,
                lastEnqueuedBlock: cursorBeforeTx.lastEnqueuedBlock,
                lastCommittedBlock: cursorBeforeTx.lastCommittedBlock,
            });
            await this.rebaseCursorAndEnqueue(chainId, latestBlock, floorBlock, depthBlocks);
            return;
        }

        await this.transactionManager.run(async (transaction) => {
            const chainCursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            if (chainCursor.lastCommittedBlock < floorBlock - 1) {
                this.logger.info("head_enqueue_deferred_until_rebase", {
                    chainId,
                    latestBlock,
                    lastCommittedBlock: chainCursor.lastCommittedBlock,
                    lastEnqueuedBlock: chainCursor.lastEnqueuedBlock,
                    floorBlock,
                });
                return;
            }

            await this.enqueueMissingBlockJobs(
                chainId,
                chainCursor.lastEnqueuedBlock,
                floorBlock,
                latestBlock,
                transaction,
            );
        });
    }

    private async initializeCursor(chainId: ChainId, latestBlock: BlockNumber): Promise<void> {
        const latestBlockData = await this.source.getBlock(chainId, latestBlock);
        await this.chainCursorRepository.insert({
            chainId,
            lastEnqueuedBlock: latestBlock,
            lastCommittedBlock: latestBlock,
            lastCommittedHash: latestBlockData.hash,
            reorgVersion: 0,
        });

        this.logger.info("chain_cursor_initialized", {
            chainId,
            latestBlock,
            latestBlockHash: latestBlockData.hash,
        });
    }

    private async rebaseCursorAndEnqueue(
        chainId: ChainId,
        latestBlock: BlockNumber,
        floorBlock: BlockNumber,
        depthBlocks: number,
    ): Promise<void> {
        const floorData = await this.source.getBlock(chainId, floorBlock);
        const floorParentHash = floorData.parentHash;
        await this.transactionManager.run(async (transaction) => {
            const chainCursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            if (chainCursor.lastCommittedBlock >= floorBlock - 1) {
                this.logger.info("head_rebase_skipped_cursor_caught_up", {
                    chainId,
                    latestBlock,
                    floorBlock,
                    lastCommittedBlock: chainCursor.lastCommittedBlock,
                    lastEnqueuedBlock: chainCursor.lastEnqueuedBlock,
                });
                await this.enqueueMissingBlockJobs(
                    chainId,
                    chainCursor.lastEnqueuedBlock,
                    floorBlock,
                    latestBlock,
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
                latestBlock,
                depthBlocks,
                floorBlock,
                rebasedToBlock: rebaseTo,
                floorParentHash,
            });

            await this.enqueueMissingBlockJobs(chainId, rebaseTo, floorBlock, latestBlock, transaction);
        });
    }

    private async enqueueMissingBlockJobs(
        chainId: ChainId,
        lastEnqueuedBlock: BlockNumber,
        floorBlock: BlockNumber,
        latestBlock: BlockNumber,
        transaction: DbExecutor,
    ): Promise<void> {
        const fromBlock = Math.max(lastEnqueuedBlock + 1, floorBlock);

        if (fromBlock > latestBlock) {
            this.logger.debug("head_enqueue_skipped_no_new_blocks", {
                chainId,
                lastEnqueuedBlock,
                floorBlock,
                latestBlock,
                fromBlock,
            });
            return;
        }

        await this.blockJobsRepository.enqueueRange(chainId, fromBlock, latestBlock, transaction);
        await this.chainCursorRepository.setLastEnqueued(chainId, latestBlock, transaction);

        this.logger.info("enqueued_block_jobs", {
            chainId,
            fromBlock,
            toBlock: latestBlock,
        });
    }
}
