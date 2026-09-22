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
import {
    combineDisposers,
    disposeAfterError,
    resolveDbDependencies,
    resolveMultiBlockSource,
    resolveLogger,
} from "../runtime/resolvers.js";
import type { MultiChainSourceConfig } from "../interfaces/source-config.js";
import type { RuntimeDbOptions, RuntimeLoggerOptions } from "../runtime/options.js";
import type { ChainId } from "../types/chain.js";
import { formatPipelineMetricsPrometheus } from "./prometheus.js";

export interface PipelineMetricsDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    blocksRepository: BlocksRepository;
    workerCursorsRepository: WorkerCursorsRepository;
}

export type PipelineMetricsOptions =
    RuntimeLoggerOptions
    & RuntimeDbOptions<PipelineMetricsDatabaseDependencies>
    & { sourceConfig: MultiChainSourceConfig; };

export class PipelineMetrics {
    static async create(options: PipelineMetricsOptions): Promise<PipelineMetrics> {
        const logger = resolveLogger(options);
        validatePipelineMetricsOptions(options);
        const resolvedSource = await resolveMultiBlockSource(options.sourceConfig, logger);
        const serviceConfig: PipelineMetricsServiceConfig = {
            chainIds: getMetricsChainIds(options.sourceConfig),
        };
        let dbDispose: (() => Promise<void>) | undefined;
        try {
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
            dbDispose = dispose;
            const service = new PipelineMetricsService(
                serviceConfig,
                resolvedSource.source,
                dependencies.chainCursorRepository,
                dependencies.blockJobsRepository,
                dependencies.blocksRepository,
                dependencies.workerCursorsRepository,
            );

            return new PipelineMetrics(service, combineDisposers(dbDispose, resolvedSource.dispose));
        } catch (error) {
            return await disposeAfterError(error, dbDispose, resolvedSource.dispose);
        }
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

function validatePipelineMetricsOptions(options: PipelineMetricsOptions): void {
    const chainIds = getMetricsChainIds(options.sourceConfig);

    if (chainIds.length === 0) {
        throw new Error("Pipeline metrics chainIds config must not be empty");
    }

    const seenChainIds = new Set<number>();

    for (const chainId of chainIds) {
        if (!Number.isInteger(chainId) || chainId <= 0) {
            throw new Error(`Pipeline metrics chain id is invalid: ${String(chainId)}`);
        }

        if (seenChainIds.has(chainId)) {
            throw new Error(`Pipeline metrics chain id is duplicated: ${String(chainId)}`);
        }

        seenChainIds.add(chainId);
    }
}

function getMetricsChainIds(config: MultiChainSourceConfig): readonly ChainId[] {
    return config.source === undefined
        ? config.networks.map(({ chainId }) => chainId)
        : config.chainIds;
}
