import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type {
    BlockJobsRepository,
    ChainCursorRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { RetentionPurgeResult } from "../interfaces/pipeline.js";
import type { RetentionWorkerOptions } from "../interfaces/options.js";

export type RetentionServiceConfig = RetentionWorkerOptions;

export class RetentionService {
    constructor(
        private readonly config: RetentionServiceConfig,
        private readonly cursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly blocksRepository: BlocksRepository,
        private readonly transactionsRepository: TransactionsRepository,
        private readonly eventsRepository: EventsRepository,
        private readonly transactionManager: TransactionManager,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async execute(): Promise<void> {
        const chainId = this.config.chainId;
        const depthBlocks = this.config.retentionDepthBlocks;

        const result = await this.transactionManager.run(async (transaction): Promise<RetentionPurgeResult> => {
            const cursor = await this.cursorRepository.get(chainId, transaction);
            if (cursor === null) {
                this.logger.debug("retention_purge_skipped_cursor_missing", {
                    chainId,
                    depthBlocks,
                });
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }

            const purgeToBlock = cursor.lastCommittedBlock - depthBlocks;
            this.logger.debug("retention_tick_observed", {
                chainId,
                depthBlocks,
                lastCommittedBlock: cursor.lastCommittedBlock,
                lastCommittedHash: cursor.lastCommittedHash,
                lastEnqueuedBlock: cursor.lastEnqueuedBlock,
                purgeToBlock,
            });

            if (purgeToBlock < 0) {
                this.logger.debug("retention_purge_skipped_before_genesis", {
                    chainId,
                    depthBlocks,
                    lastCommittedBlock: cursor.lastCommittedBlock,
                    purgeToBlock,
                });
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }

            const oldestBlock = await this.blocksRepository.getOldestBlockNumber(chainId, transaction);
            if (oldestBlock === null) {
                this.logger.debug("retention_purge_skipped_no_blocks", {
                    chainId,
                    depthBlocks,
                    lastCommittedBlock: cursor.lastCommittedBlock,
                    purgeToBlock,
                });
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }

            if (oldestBlock > purgeToBlock) {
                this.logger.debug("retention_purge_skipped_oldest_after_cutoff", {
                    chainId,
                    depthBlocks,
                    lastCommittedBlock: cursor.lastCommittedBlock,
                    oldestBlock,
                    purgeToBlock,
                });
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }

            this.logger.debug("retention_purge_stage_started", {
                chainId,
                depthBlocks,
                stage: "block_jobs",
                fromBlock: oldestBlock,
                toBlock: purgeToBlock,
            });
            const deletedBlockJobs = await this.blockJobsRepository.deleteBlockNumberRange(
                chainId,
                oldestBlock,
                purgeToBlock,
                transaction
            );

            this.logger.debug("retention_purge_stage_started", {
                chainId,
                depthBlocks,
                stage: "blocks",
                fromBlock: oldestBlock,
                toBlock: purgeToBlock,
            });
            const deletedBlocks = await this.blocksRepository.deleteBlockNumberRange(
                chainId,
                oldestBlock,
                purgeToBlock,
                transaction
            );

            this.logger.debug("retention_purge_stage_started", {
                chainId,
                depthBlocks,
                stage: "transactions",
                fromBlock: oldestBlock,
                toBlock: purgeToBlock,
            });
            const deletedTransactions = await this.transactionsRepository.deleteBlockNumberRange(
                chainId,
                oldestBlock,
                purgeToBlock,
                transaction
            );

            this.logger.debug("retention_purge_stage_started", {
                chainId,
                depthBlocks,
                stage: "events",
                fromBlock: oldestBlock,
                toBlock: purgeToBlock,
            });
            const deletedEvents = await this.eventsRepository.deleteBlockNumberRange(
                chainId,
                oldestBlock,
                purgeToBlock,
                transaction
            );

            return {
                deletedBlockJobs,
                deletedBlocks,
                deletedTransactions,
                deletedEvents,
            };
        });

        this.logger.info("retention_purged", { chainId, depthBlocks, ...result });
    }
}
