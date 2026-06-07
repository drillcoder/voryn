import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { ChainCursor } from "../interfaces/pipeline.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { SequencerWorkerOptions } from "../interfaces/options.js";
import type { BlockNumber, ChainId, HashHex } from "../types/chain.js";

interface CommonAncestor {
    blockNumber: BlockNumber;
    blockHash: HashHex;
}

export type SequencerServiceConfig = SequencerWorkerOptions;

export class SequencerService {
    constructor(
        private readonly config: SequencerServiceConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blocksRepository: BlocksRepository,
        private readonly transactionsRepository: TransactionsRepository,
        private readonly eventsRepository: EventsRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly transactionManager: TransactionManager,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async execute(): Promise<void> {
        const chainId = this.config.chainId;
        const maxBlocksPerTick = Math.max(1, this.config.maxBlocksPerTick);
        const committedBlocks: number[] = [];

        for (let index = 0; index < maxBlocksPerTick; index++) {
            const cursor = await this.chainCursorRepository.get(chainId);
            if (cursor === null) {
                this.logger.debug("sequencer_cursor_missing", {
                    chainId,
                    iteration: index,
                    maxBlocksPerTick,
                });
                break;
            }

            const nextBlock = cursor.lastCommittedBlock + 1;
            this.logger.debug("sequencer_tick_observed", {
                chainId,
                iteration: index,
                maxBlocksPerTick,
                lastCommittedBlock: cursor.lastCommittedBlock,
                lastCommittedHash: cursor.lastCommittedHash,
                lastEnqueuedBlock: cursor.lastEnqueuedBlock,
                nextBlock,
            });

            const job = await this.blockJobsRepository.get(chainId, nextBlock);
            if (job?.status !== "fetched") {
                this.logBlockedByJobStatus(chainId, nextBlock, job, cursor);
                break;
            }

            const block = await this.blocksRepository.get(chainId, nextBlock);
            if (block === null) {
                throw new Error(
                    `Fetched block data is missing for chain ${String(chainId)} block ${String(nextBlock)}`
                );
            }

            this.logger.debug("sequencer_next_block_loaded", {
                chainId,
                blockNumber: block.blockNumber,
                blockHash: block.blockHash,
                parentHash: block.parentHash,
                expectedParentHash: cursor.lastCommittedHash,
            });

            if (block.parentHash !== cursor.lastCommittedHash) {
                this.logger.warn("sequencer_parent_hash_mismatch", {
                    chainId,
                    cursorBlock: cursor.lastCommittedBlock,
                    cursorHash: cursor.lastCommittedHash,
                    nextBlock: block.blockNumber,
                    nextBlockHash: block.blockHash,
                    nextBlockParentHash: block.parentHash,
                });
                await this.rollbackReorg(cursor);
                break;
            }

            const committedBlock = await this.transactionManager.run(async (transaction): Promise<number> => {
                const currentJob = await this.blockJobsRepository.get(chainId, nextBlock, transaction);
                if (currentJob?.status !== "fetched") {
                    throw new Error(
                        `Fetched block job changed before commit for chain ${String(chainId)} `
                        + `block ${String(nextBlock)}`
                    );
                }

                const currentBlock = await this.blocksRepository.get(chainId, nextBlock, transaction);
                if (currentBlock?.parentHash !== cursor.lastCommittedHash) {
                    throw new Error(
                        `Fetched block data changed before commit for chain ${String(chainId)} `
                        + `block ${String(nextBlock)}`
                    );
                }

                await this.chainCursorRepository.advanceLastCommitted(
                    cursor.chainId,
                    cursor.lastCommittedBlock,
                    cursor.lastCommittedHash,
                    currentBlock.blockNumber,
                    currentBlock.blockHash,
                    transaction
                );
                await this.blockJobsRepository.markCommitted(cursor.chainId, currentBlock.blockNumber, transaction);
                return currentBlock.blockNumber;
            });

            committedBlocks.push(committedBlock);
        }

        if (committedBlocks.length > 0) {
            this.logger.info("sequencer_blocks_committed", {
                chainId,
                committedCount: committedBlocks.length,
                firstBlockNumber: committedBlocks[0],
                lastBlockNumber: committedBlocks[committedBlocks.length - 1],
            });
        }
    }

    private logBlockedByJobStatus(
        chainId: ChainId,
        blockNumber: BlockNumber,
        job: Awaited<ReturnType<BlockJobsRepository["get"]>>,
        cursor: ChainCursor,
    ): void {
        const baseMeta = {
            chainId,
            blockNumber,
            lastCommittedBlock: cursor.lastCommittedBlock,
            lastCommittedHash: cursor.lastCommittedHash,
            lastEnqueuedBlock: cursor.lastEnqueuedBlock,
        };

        if (job === null) {
            this.logger.debug("sequencer_waiting_for_block_job", baseMeta);
            return;
        }

        if (job.status === "failed" && job.nextRetryAt === null) {
            this.logger.warn("sequencer_blocked_by_failed_job", {
                ...baseMeta,
                attempts: job.attempts,
                error: job.error,
                updatedAt: job.updatedAt,
            });
            return;
        }

        if (job.status === "failed") {
            this.logger.debug("sequencer_waiting_for_failed_job_retry", {
                ...baseMeta,
                attempts: job.attempts,
                nextRetryAt: job.nextRetryAt,
                error: job.error,
            });
            return;
        }

        this.logger.debug("sequencer_waiting_for_block_fetch", {
            ...baseMeta,
            status: job.status,
            attempts: job.attempts,
            updatedAt: job.updatedAt,
        });
    }

    private async rollbackReorg(candidateCursor: ChainCursor): Promise<void> {
        const chainId = this.config.chainId;
        const ancestor = await this.findCommonAncestor(candidateCursor);

        const result = await this.transactionManager.run(async (transaction) => {
            const cursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);
            if (cursor === null) {
                this.logger.debug("sequencer_reorg_rollback_skipped_cursor_missing", {
                    chainId,
                    candidateBlock: candidateCursor.lastCommittedBlock,
                    candidateHash: candidateCursor.lastCommittedHash,
                });
                return null;
            }

            if (
                cursor.lastCommittedBlock !== candidateCursor.lastCommittedBlock
                || cursor.lastCommittedHash !== candidateCursor.lastCommittedHash
            ) {
                this.logger.debug("sequencer_reorg_rollback_skipped_cursor_changed", {
                    chainId,
                    candidateBlock: candidateCursor.lastCommittedBlock,
                    candidateHash: candidateCursor.lastCommittedHash,
                    currentBlock: cursor.lastCommittedBlock,
                    currentHash: cursor.lastCommittedHash,
                });
                return null;
            }

            const nextBlock = cursor.lastCommittedBlock + 1;
            const block = await this.blocksRepository.get(chainId, nextBlock, transaction);
            if (block === null) {
                this.logger.debug("sequencer_reorg_rollback_skipped_next_block_missing", {
                    chainId,
                    nextBlock,
                    cursorBlock: cursor.lastCommittedBlock,
                    cursorHash: cursor.lastCommittedHash,
                });
                return null;
            }

            if (block.parentHash === cursor.lastCommittedHash) {
                this.logger.debug("sequencer_reorg_rollback_skipped_next_block_matches", {
                    chainId,
                    nextBlock,
                    nextBlockHash: block.blockHash,
                    nextBlockParentHash: block.parentHash,
                    cursorBlock: cursor.lastCommittedBlock,
                    cursorHash: cursor.lastCommittedHash,
                });
                return null;
            }

            const rollbackFromBlock = ancestor.blockNumber + 1;
            const rollbackToBlock = cursor.lastEnqueuedBlock;

            const deletedEvents = await this.eventsRepository.deleteBlockNumberRange(
                chainId,
                rollbackFromBlock,
                rollbackToBlock,
                transaction
            );
            const deletedTransactions = await this.transactionsRepository.deleteBlockNumberRange(
                chainId,
                rollbackFromBlock,
                rollbackToBlock,
                transaction
            );
            const deletedBlocks = await this.blocksRepository.deleteBlockNumberRange(
                chainId,
                rollbackFromBlock,
                rollbackToBlock,
                transaction
            );
            const deletedBlockJobs = await this.blockJobsRepository.deleteBlockNumberRange(
                chainId,
                rollbackFromBlock,
                rollbackToBlock,
                transaction
            );

            await this.chainCursorRepository.setPositions(
                chainId,
                ancestor.blockNumber,
                ancestor.blockHash,
                ancestor.blockNumber,
                transaction
            );

            return {
                fromBlock: rollbackFromBlock,
                toBlock: rollbackToBlock,
                ancestorBlock: ancestor.blockNumber,
                ancestorHash: ancestor.blockHash,
                deletedBlockJobs,
                deletedBlocks,
                deletedTransactions,
                deletedEvents,
            };
        });

        if (result !== null) {
            this.logger.warn("sequencer_reorg_rollback", { chainId, ...result });
        }
    }

    private async findCommonAncestor(cursor: ChainCursor): Promise<CommonAncestor> {
        this.logger.debug("sequencer_common_ancestor_search_started", {
            chainId: cursor.chainId,
            fromBlock: cursor.lastCommittedBlock,
            fromHash: cursor.lastCommittedHash,
        });

        for (let blockNumber = cursor.lastCommittedBlock; blockNumber >= 0; blockNumber--) {
            const [pipelineBlock, sourceBlock] = await Promise.all([
                this.blocksRepository.get(cursor.chainId, blockNumber),
                this.source.getBlock(cursor.chainId, blockNumber),
            ]);

            if (pipelineBlock !== null && pipelineBlock.blockHash === sourceBlock.hash) {
                this.logger.debug("sequencer_common_ancestor_found", {
                    chainId: cursor.chainId,
                    ancestorBlock: blockNumber,
                    ancestorHash: pipelineBlock.blockHash,
                });
                return {
                    blockNumber,
                    blockHash: pipelineBlock.blockHash,
                };
            }

            this.logger.debug("sequencer_common_ancestor_checked", {
                chainId: cursor.chainId,
                blockNumber,
                pipelineHash: pipelineBlock?.blockHash ?? null,
                sourceHash: sourceBlock.hash,
                matched: false,
            });
        }

        throw new Error(
            `Cannot find common ancestor for chain ${String(cursor.chainId)} `
            + `from block ${String(cursor.lastCommittedBlock)}`
        );
    }

}
