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
import type { RetentionWorkerOptions } from "../runtime/types.js";

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
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }
            const purgeToBlock = cursor.lastCommittedBlock - depthBlocks;
            if (purgeToBlock < 0) {
                return {
                    deletedBlockJobs: 0,
                    deletedBlocks: 0,
                    deletedTransactions: 0,
                    deletedEvents: 0,
                };
            }

            const deletedBlockJobs = await this.blockJobsRepository.deleteAtOrBeforeBlockNumber(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedBlocks = await this.blocksRepository.deleteAtOrBeforeBlockNumber(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedTransactions = await this.transactionsRepository.deleteAtOrBeforeBlockNumber(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedEvents = await this.eventsRepository.deleteAtOrBeforeBlockNumber(
                chainId,
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
