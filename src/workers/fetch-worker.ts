import type { BlockSource } from "../contracts/block-source.js";
import { type Logger, noopLogger } from "../contracts/logger.js";
import type { BlockJobQueueStore, RawBlockStore } from "../contracts/stores.js";
import type { IngestionConfig } from "../types/runtime.js";
import { asErrorMessage } from "../utils/errors.js";
import { PollingWorker } from "./polling-worker.js";

export interface FetchWorkerDeps {
    workerId: string;
    config: IngestionConfig;
    source: BlockSource;
    jobStore: BlockJobQueueStore;
    rawBlockStore: RawBlockStore;
    logger?: Logger;
}

export class FetchWorker extends PollingWorker {
    constructor(private readonly deps: FetchWorkerDeps) {
        super(
            `fetch:${deps.config.chainId}:${deps.workerId}`,
            deps.config.pollIntervalMs,
            deps.logger ?? noopLogger
        );
    }

    protected async tick(): Promise<void> {
        const batchSize = Math.max(1, this.deps.config.fetchBatchSize);

        for (let index = 0; index < batchSize; index++) {
            const job = await this.deps.jobStore.claimForFetch(
                this.deps.config.chainId,
                this.deps.workerId
            );

            if (!job) {
                break;
            }

            try {
                const fetched = await this.deps.source.getBlockData(
                    this.deps.config.chainId,
                    job.blockNumber
                );

                await this.deps.rawBlockStore.save({
                    chainId: this.deps.config.chainId,
                    blockNumber: job.blockNumber,
                    blockHash: fetched.block.hash,
                    parentHash: fetched.block.parentHash,
                    payload: fetched,
                    fetchedAt: new Date(),
                });

                await this.deps.jobStore.markFetched(this.deps.config.chainId, job.blockNumber);
            } catch (error) {
                const nextRetryAt = this.buildNextRetryAt(job.attempts + 1);
                await this.deps.jobStore.markFetchFailed(
                    this.deps.config.chainId,
                    job.blockNumber,
                    asErrorMessage(error),
                    nextRetryAt
                );
            }
        }
    }

    private buildNextRetryAt(attemptNumber: number): Date | null {
        const { maxAttempts, baseDelayMs, maxDelayMs } = this.deps.config.retry;
        if (attemptNumber >= maxAttempts) {
            return null;
        }

        const safeBaseDelayMs = Math.max(1, baseDelayMs);
        const safeMaxDelayMs = Math.max(safeBaseDelayMs, maxDelayMs);
        const exp = Math.max(0, attemptNumber - 1);
        const delayMs = Math.min(safeMaxDelayMs, safeBaseDelayMs * (2 ** exp));
        return new Date(Date.now() + delayMs);
    }
}
