import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { RetentionPurgeResult } from "../interfaces/pipeline.js";
import type { RetentionWorkerConfig } from "../interfaces/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export class RetentionWorker extends SingletonPollingWorker {
    constructor(
        private readonly config: RetentionWorkerConfig,
        private readonly cursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly canonicalBlocksRepository: CanonicalBlocksRepository,
        private readonly canonicalTransactionsRepository: CanonicalTransactionsRepository,
        private readonly canonicalEventsRepository: CanonicalEventsRepository,
        private readonly transactionManager: TransactionManager,
        leaderLock: LeaderLock,
        logger?: Logger,
    ) {
        super(
            `retention:${String(config.chainId)}`,
            config.pollIntervalMs,
            logger ?? noopLogger,
            leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const chainId = this.config.chainId;
        const depthBlocks = this.config.retentionDepthBlocks;

        if (depthBlocks <= 0) {
            return;
        }

        const result = await this.transactionManager.run(async (transaction): Promise<RetentionPurgeResult> => {
            const cursor = await this.cursorRepository.get(chainId, transaction);
            if (cursor === null) {
                return {
                    deletedBlockJobs: 0,
                    deletedRawBlocks: 0,
                    deletedCanonicalBlocks: 0,
                    deletedCanonicalTransactions: 0,
                    deletedCanonicalEvents: 0,
                };
            }
            const purgeToBlock = cursor.lastCommittedBlock - depthBlocks;
            if (purgeToBlock < 0) {
                return {
                    deletedBlockJobs: 0,
                    deletedRawBlocks: 0,
                    deletedCanonicalBlocks: 0,
                    deletedCanonicalTransactions: 0,
                    deletedCanonicalEvents: 0,
                };
            }

            const deletedBlockJobs = await this.blockJobsRepository.deleteUpToBlock(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedRawBlocks = await this.rawBlocksRepository.deleteUpToBlock(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedCanonicalBlocks = await this.canonicalBlocksRepository.deleteUpToBlock(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedCanonicalTransactions = await this.canonicalTransactionsRepository.deleteUpToBlock(
                chainId,
                purgeToBlock,
                transaction
            );
            const deletedCanonicalEvents = await this.canonicalEventsRepository.deleteUpToBlock(
                chainId,
                purgeToBlock,
                transaction
            );

            return {
                deletedBlockJobs,
                deletedRawBlocks,
                deletedCanonicalBlocks,
                deletedCanonicalTransactions,
                deletedCanonicalEvents,
            };
        });

        this.logger.info("retention_purged", { chainId, depthBlocks, ...result });
    }
}
