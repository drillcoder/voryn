import type { Pool } from "pg";
import type { PipelineMetricsResult } from "../interfaces/metrics.js";
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
import type { PipelineMetricsServiceConfig } from "../services/pipeline-metrics-service.js";
import { resolveDbDependencies, resolveMultiBlockSource, resolveLogger } from "../runtime/resolvers.js";
import type { PipelineMetricsOptions, RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/types.js";
import type { MultiSourceOptions } from "../runtime/types.js";
import { formatPipelineMetricsPrometheus } from "./prometheus.js";

export interface PipelineMetricsDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    workerCursorsRepository: WorkerCursorsRepository;
}

export type CreatePipelineMetricsOptions =
    RuntimeLoggerOptions
    & PipelineMetricsOptions
    & MultiSourceOptions
    & RuntimeDbOptions<PipelineMetricsDatabaseDependencies>;

export class PipelineMetrics {
    static async create(options: CreatePipelineMetricsOptions): Promise<PipelineMetrics> {
        const logger = resolveLogger(options);
        validatePipelineMetricsOptions(options);
        const source = await resolveMultiBlockSource(options);
        const serviceConfig: PipelineMetricsServiceConfig = {
            chainIds: options.chainIds,
        };
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
            serviceConfig,
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

    async get(): Promise<PipelineMetricsResult> {
        return this.service.get();
    }

    async getPrometheus(): Promise<string> {
        return formatPipelineMetricsPrometheus(await this.get());
    }

    async close(): Promise<void> {
        await this.dispose?.();
    }
}

function validatePipelineMetricsOptions(options: CreatePipelineMetricsOptions): void {
    if (options.chainIds.length === 0) {
        throw new Error("Pipeline metrics chainIds config must not be empty");
    }

    const seenChainIds = new Set<number>();

    for (const chainId of options.chainIds) {
        if (!Number.isInteger(chainId) || chainId <= 0) {
            throw new Error(`Pipeline metrics chain id is invalid: ${String(chainId)}`);
        }

        if (seenChainIds.has(chainId)) {
            throw new Error(`Pipeline metrics chain id is duplicated: ${String(chainId)}`);
        }

        seenChainIds.add(chainId);
    }

    if (options.rpcUrls !== undefined && options.chainIds.length !== options.rpcUrls.length) {
        throw new Error("Pipeline metrics chainIds and rpcUrls configs must have the same length");
    }
}
