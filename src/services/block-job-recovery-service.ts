import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { BlockJobsRepository } from "../interfaces/repositories.js";
import type { BlockNumber, ChainId } from "../types/chain.js";

export interface BlockJobRecoveryOptions {
    chainId: ChainId;
}

export interface RetryFailedBlockJobsResult {
    chainId: ChainId;
    fromBlock: BlockNumber;
    toBlock: BlockNumber;
    retried: number;
}

export class BlockJobRecoveryService {
    constructor(
        private readonly config: BlockJobRecoveryOptions,
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
