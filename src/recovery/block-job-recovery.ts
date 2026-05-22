import type { Pool } from "pg";

import type { BlockJobsRepository } from "../interfaces/repositories.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import type { RuntimeBaseOptions, RuntimeDbOptions } from "../runtime/types.js";
import type { BlockNumber } from "../types/chain.js";
import type { BlockJobRecoveryConfig, RetryFailedBlockJobsResult } from "../services/block-job-recovery-service.js";
import { BlockJobRecoveryService } from "../services/block-job-recovery-service.js";

export interface BlockJobRecoveryDatabaseDependencies {
    blockJobsRepository: BlockJobsRepository;
}

export type CreateBlockJobRecoveryOptions =
    RuntimeBaseOptions<BlockJobRecoveryConfig>
    & RuntimeDbOptions<BlockJobRecoveryDatabaseDependencies>;

export class BlockJobRecovery {
    static async create(options: CreateBlockJobRecoveryOptions): Promise<BlockJobRecovery> {
        const logger = resolveLogger(options);
        const { dependencies, dispose } = await resolveDbDependencies<BlockJobRecoveryDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): BlockJobRecoveryDatabaseDependencies => ({
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
            })
        );
        const service = new BlockJobRecoveryService(
            options.config,
            dependencies.blockJobsRepository,
            logger,
        );

        return new BlockJobRecovery(service, dispose);
    }

    private constructor(
        private readonly service: BlockJobRecoveryService,
        private readonly dispose?: () => Promise<void>,
    ) {
    }

    async retryFailedBlock(blockNumber: BlockNumber): Promise<RetryFailedBlockJobsResult> {
        return this.service.retryFailedBlock(blockNumber);
    }

    async retryFailedRange(fromBlock: BlockNumber, toBlock: BlockNumber): Promise<RetryFailedBlockJobsResult> {
        return this.service.retryFailedBlockRange(fromBlock, toBlock);
    }

    async close(): Promise<void> {
        await this.dispose?.();
    }
}
