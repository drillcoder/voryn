import type { Pool } from "pg";

import type { BlockJobsRepository } from "../interfaces/repositories.js";
import type { BlockJobRecoveryOptions, RuntimeDbOptions, RuntimeLoggerOptions } from "../interfaces/options.js";
import type { BlockJobRecoveryServiceConfig } from "../services/block-job-recovery-service.js";
import type { RetryAllFailedBlockJobsResult, RetryFailedBlockJobsResult } from "../interfaces/recovery.js";
import type { BlockNumber } from "../types/chain.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { resolveDbDependencies, resolveLogger } from "../runtime/resolvers.js";
import { BlockJobRecoveryService } from "../services/block-job-recovery-service.js";

export interface BlockJobRecoveryDatabaseDependencies {
    blockJobsRepository: BlockJobsRepository;
}

export type CreateBlockJobRecoveryOptions =
    RuntimeLoggerOptions
    & BlockJobRecoveryOptions
    & RuntimeDbOptions<BlockJobRecoveryDatabaseDependencies>;

export class BlockJobRecovery {
    static async create(options: CreateBlockJobRecoveryOptions): Promise<BlockJobRecovery> {
        const logger = resolveLogger(options);
        const serviceConfig: BlockJobRecoveryServiceConfig = {
            chainId: options.chainId,
        };
        const { dependencies, dispose } = await resolveDbDependencies<BlockJobRecoveryDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): BlockJobRecoveryDatabaseDependencies => ({
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
            })
        );
        const service = new BlockJobRecoveryService(
            serviceConfig,
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

    async retryFailedBlockRange(fromBlock: BlockNumber, toBlock: BlockNumber): Promise<RetryFailedBlockJobsResult> {
        return this.service.retryFailedBlockRange(fromBlock, toBlock);
    }

    async retryAllFailedBlocks(): Promise<RetryAllFailedBlockJobsResult> {
        return this.service.retryAllFailedBlocks();
    }

    async close(): Promise<void> {
        await this.dispose?.();
    }
}
