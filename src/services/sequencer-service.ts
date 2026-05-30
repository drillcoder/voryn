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
import type { SequencerWorkerOptions } from "../runtime/types.js";
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
                break;
            }

            const nextBlock = cursor.lastCommittedBlock + 1;
            const job = await this.blockJobsRepository.get(chainId, nextBlock);
            if (job?.status !== "fetched") {
                this.logBlockedByJobStatus(chainId, nextBlock, job);
                break;
            }

            const block = await this.blocksRepository.get(chainId, nextBlock);
            if (block === null) {
                throw new Error(
                    `Fetched block data is missing for chain ${String(chainId)} block ${String(nextBlock)}`
                );
            }

            if (block.parentHash !== cursor.lastCommittedHash) {
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
        } else {
            this.logger.debug("sequencer_no_block_to_commit", { chainId });
        }
    }

    private logBlockedByJobStatus(
        chainId: ChainId,
        blockNumber: BlockNumber,
        job: Awaited<ReturnType<BlockJobsRepository["get"]>>
    ): void {
        if (job === null) {
            this.logger.debug("sequencer_waiting_for_block_job", { chainId, blockNumber });
            return;
        }

        if (job.status === "failed" && job.nextRetryAt === null) {
            this.logger.warn("sequencer_blocked_by_failed_job", {
                chainId,
                blockNumber,
                attempts: job.attempts,
                error: job.error,
                updatedAt: job.updatedAt,
            });
            return;
        }

        if (job.status === "failed") {
            this.logger.debug("sequencer_waiting_for_failed_job_retry", {
                chainId,
                blockNumber,
                attempts: job.attempts,
                nextRetryAt: job.nextRetryAt,
                error: job.error,
            });
            return;
        }

        this.logger.debug("sequencer_waiting_for_block_fetch", {
            chainId,
            blockNumber,
            status: job.status,
            attempts: job.attempts,
        });
    }

    private async rollbackReorg(candidateCursor: ChainCursor): Promise<void> {
        const chainId = this.config.chainId;
        const ancestor = await this.findCommonAncestor(candidateCursor);

        const result = await this.transactionManager.run(async (transaction) => {
            const cursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);
            if (cursor === null) {
                return null;
            }

            if (
                cursor.lastCommittedBlock !== candidateCursor.lastCommittedBlock
                || cursor.lastCommittedHash !== candidateCursor.lastCommittedHash
            ) {
                return null;
            }

            const nextBlock = cursor.lastCommittedBlock + 1;
            const block = await this.blocksRepository.get(chainId, nextBlock, transaction);
            if (block === null || block.parentHash === cursor.lastCommittedHash) {
                return null;
            }

            const deletedEvents = await this.eventsRepository.deleteAfterBlockNumber(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedTransactions = await this.transactionsRepository.deleteAfterBlockNumber(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedBlocks = await this.blocksRepository.deleteAfterBlockNumber(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedBlockJobs = await this.blockJobsRepository.deleteAfterBlockNumber(
                chainId,
                ancestor.blockNumber,
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
                fromBlock: ancestor.blockNumber + 1,
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
        for (let blockNumber = cursor.lastCommittedBlock; blockNumber >= 0; blockNumber--) {
            const [pipelineBlock, sourceBlock] = await Promise.all([
                this.blocksRepository.get(cursor.chainId, blockNumber),
                this.source.getBlock(cursor.chainId, blockNumber),
            ]);

            if (pipelineBlock !== null && pipelineBlock.blockHash === sourceBlock.hash) {
                return {
                    blockNumber,
                    blockHash: pipelineBlock.blockHash,
                };
            }
        }

        throw new Error(
            `Cannot find common ancestor for chain ${String(cursor.chainId)} `
            + `from block ${String(cursor.lastCommittedBlock)}`
        );
    }

}
