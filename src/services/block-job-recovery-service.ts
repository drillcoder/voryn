import type { Logger } from "../interfaces/logger.js";
import type { BlockJobsRepository } from "../interfaces/repositories.js";
import type { BlockJobRecoveryOptions } from "../interfaces/options.js";
import type { BlockNumber } from "../types/chain.js";
import type { RetryFailedBlockJobsResult } from "../interfaces/recovery.js";
import { noopLogger } from "../interfaces/logger.js";

export type BlockJobRecoveryServiceConfig = BlockJobRecoveryOptions;

export class BlockJobRecoveryService {
    constructor(
        private readonly config: BlockJobRecoveryServiceConfig,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async retryFailedBlock(blockNumber: BlockNumber): Promise<RetryFailedBlockJobsResult> {
        return this.retryFailedBlockRange(blockNumber, blockNumber);
    }

    async retryFailedBlockRange(fromBlock: BlockNumber, toBlock: BlockNumber): Promise<RetryFailedBlockJobsResult> {
        if (fromBlock > toBlock) {
            throw new Error(
                `Cannot retry failed block jobs: fromBlock ${String(fromBlock)} is greater than `
                + `toBlock ${String(toBlock)}`
            );
        }

        const retried = await this.blockJobsRepository.retryFailed(this.config.chainId, fromBlock, toBlock);

        const result = {
            chainId: this.config.chainId,
            fromBlock,
            toBlock,
            retried,
        };

        this.logger.info("failed_block_jobs_retry_requested", result);
        return result;
    }
}
