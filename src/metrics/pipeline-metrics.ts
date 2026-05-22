import type { Pool } from "pg";
import type { BlockSource } from "../interfaces/block-source.js";
import type { ChainPipelineMetrics, PipelineMetricsConfig } from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    BlocksRepository,
    ChainCursorRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { PipelineMetricsService } from "../services/pipeline-metrics-service.js";
import { resolveDbDependencies, resolveEthersSource, resolveLogger } from "../runtime/resolvers.js";
import type { RuntimeBaseOptions, RuntimeDbOptions, RuntimeSourceOptions } from "../runtime/types.js";
import { formatPipelineMetricsPrometheus } from "./prometheus.js";

export interface PipelineMetricsDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    workerCursorsRepository: WorkerCursorsRepository;
}

export type CreatePipelineMetricsOptions =
    RuntimeBaseOptions<PipelineMetricsConfig>
    & RuntimeSourceOptions<BlockSource>
    & RuntimeDbOptions<PipelineMetricsDatabaseDependencies>;

export class PipelineMetrics {
    static async create(options: CreatePipelineMetricsOptions): Promise<PipelineMetrics> {
        const logger = resolveLogger(options);
        const source = resolveEthersSource(options.config.chainId, options);
        const { dependencies, dispose } = await resolveDbDependencies<PipelineMetricsDatabaseDependencies>(
            options,
            logger,
            (pool: Pool): PipelineMetricsDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                blocksRepository: new PostgresBlocksRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
            })
        );
        const service = new PipelineMetricsService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.blocksRepository,
            dependencies.workerCursorsRepository,
        );

        return new PipelineMetrics(service, dispose);
    }

    private constructor(
        private readonly service: PipelineMetricsService,
        private readonly dispose?: () => Promise<void>,
    ) {
    }

    async get(): Promise<ChainPipelineMetrics> {
        return this.service.get();
    }

    async getPrometheus(): Promise<string> {
        return formatPipelineMetricsPrometheus(await this.get());
    }

    async close(): Promise<void> {
        await this.dispose?.();
    }
}
