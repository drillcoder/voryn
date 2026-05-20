import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    EventsRepository,
    TransactionsRepository,
} from "../interfaces/repositories.js";
import type { FetchWorkerConfig } from "../interfaces/runtime.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import { asErrorMessage } from "../utils/errors.js";

export interface FetchServiceConfig extends FetchWorkerConfig {
    instanceId: string;
}

export class FetchService {
    constructor(
        private readonly config: FetchServiceConfig,
        private readonly source: BlockSource,
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
        const batchSize = Math.max(1, this.config.fetchBatchSize);
        const staleClaimedBefore = new Date(Date.now() - Math.max(1, this.config.fetchClaimTtlMs));
        let claimed = 0;
        let fetched = 0;
        let failed = 0;

        this.logger.debug("fetch_tick_started", {
            chainId,
            instanceId: this.config.instanceId,
            batchSize,
            staleClaimedBefore,
        });

        for (let index = 0; index < batchSize; index++) {
            this.logger.debug("fetch_claim_started", {
                chainId,
                instanceId: this.config.instanceId,
                batchIndex: index,
            });
            const job = await this.blockJobsRepository.claimForFetch(
                chainId,
                this.config.instanceId,
                staleClaimedBefore
            );

            if (job === null) {
                this.logger.debug("fetch_claim_empty", {
                    chainId,
                    instanceId: this.config.instanceId,
                    batchIndex: index,
                });
                break;
            }
            claimed += 1;

            this.logger.debug("fetch_claim_completed", {
                chainId,
                instanceId: this.config.instanceId,
                blockNumber: job.blockNumber,
                batchIndex: index,
            });

            try {
                const fetchedBlock = await this.source.getBlockData(chainId, job.blockNumber);
                this.logger.debug("fetch_block_data_load_completed", {
                    chainId,
                    instanceId: this.config.instanceId,
                    blockNumber: job.blockNumber,
                    transactionCount: fetchedBlock.transactions.length,
                    eventCount: fetchedBlock.logs.length,
                });

                await this.transactionManager.run(async (transaction) => {
                    await this.blocksRepository.insert({
                        chainId: chainId,
                        blockNumber: job.blockNumber,
                        blockHash: fetchedBlock.block.hash,
                        parentHash: fetchedBlock.block.parentHash,
                        blockTimestamp: fetchedBlock.block.timestamp,
                        fetchedAt: new Date(),
                    }, transaction);
                    await this.transactionsRepository.insertMany(fetchedBlock.transactions, transaction);
                    await this.eventsRepository.insertMany(fetchedBlock.logs, transaction);

                    await this.blockJobsRepository.markFetched(
                        chainId,
                        job.blockNumber,
                        this.config.instanceId,
                        transaction
                    );
                });
                this.logger.debug("fetch_block_data_save_completed", {
                    chainId,
                    instanceId: this.config.instanceId,
                    blockNumber: job.blockNumber,
                    transactionCount: fetchedBlock.transactions.length,
                    eventCount: fetchedBlock.logs.length,
                });
                fetched += 1;
            } catch (error) {
                this.logger.debug("fetch_block_processing_failed", {
                    chainId,
                    instanceId: this.config.instanceId,
                    blockNumber: job.blockNumber,
                    error: asErrorMessage(error),
                });

                if (this.isClaimLostError(error)) {
                    this.logger.warn("fetch_claim_lost_before_mark_fetched", {
                        chainId,
                        blockNumber: job.blockNumber,
                        instanceId: this.config.instanceId,
                    });
                    continue;
                }

                const nextRetryAt = this.buildNextRetryAt(job.attempts + 1);
                try {
                    await this.blockJobsRepository.markFetchFailed(
                        chainId,
                        job.blockNumber,
                        this.config.instanceId,
                        asErrorMessage(error),
                        nextRetryAt,
                    );
                    this.logger.debug("fetch_job_marked_failed", {
                        chainId,
                        instanceId: this.config.instanceId,
                        blockNumber: job.blockNumber,
                        attemptNumber: job.attempts + 1,
                        nextRetryAt,
                    });
                    failed += 1;
                } catch (markError) {
                    if (this.isClaimLostError(markError)) {
                        this.logger.warn("fetch_claim_lost_before_mark_failed", {
                            chainId,
                            blockNumber: job.blockNumber,
                            instanceId: this.config.instanceId,
                        });
                        continue;
                    }

                    throw markError;
                }
            }
        }

        if (claimed > 0) {
            this.logger.info("fetch_tick_processed", {
                chainId,
                instanceId: this.config.instanceId,
                claimed,
                fetched,
                failed,
            });
        }
    }

    private buildNextRetryAt(attemptNumber: number): Date | null {
        if (attemptNumber >= this.config.retryMaxAttempts) {
            return null;
        }

        const safeBaseDelayMs = Math.max(1, this.config.retryBaseDelayMs);
        const safeMaxDelayMs = Math.max(safeBaseDelayMs, this.config.retryMaxDelayMs);
        const exp = Math.max(0, attemptNumber - 1);
        const delayMs = Math.min(safeMaxDelayMs, safeBaseDelayMs * (2 ** exp));
        return new Date(Date.now() + delayMs);
    }

    private isClaimLostError(error: unknown): boolean {
        const message = asErrorMessage(error);
        return message.startsWith("Cannot mark block job as fetched")
            || message.startsWith("Cannot mark block job as failed");
    }
}
