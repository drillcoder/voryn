import type { Pool } from "pg";
import type { BlockSource } from "../interfaces/block-source.js";
import type { ChainPipelineMetrics, PipelineMetricsConfig } from "../interfaces/metrics.js";
import type {
    BlockJobsRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import { PostgresBlockJobsRepository } from "../repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalEventsRepository } from "../repositories/postgres/canonical-events-repository.js";
import { PostgresCanonicalTransactionsRepository } from "../repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../repositories/postgres/raw-blocks-repository.js";
import { PostgresWorkerCursorsRepository } from "../repositories/postgres/worker-cursors-repository.js";
import { PipelineMetricsService } from "../services/pipeline-metrics-service.js";
import { resolveDbDependencies, resolveEthersSource } from "../runtime/resolvers.js";
import type { WorkerBaseOptions, WorkerDbOptions, WorkerSourceOptions } from "../runtime/types.js";

export interface PipelineMetricsDatabaseDependencies {
    chainCursorRepository: ChainCursorRepository;
    blockJobsRepository: BlockJobsRepository;
    rawBlocksRepository: RawBlocksRepository;
    canonicalTransactionsRepository: CanonicalTransactionsRepository;
    canonicalEventsRepository: CanonicalEventsRepository;
    workerCursorsRepository: WorkerCursorsRepository;
}

export type CreatePipelineMetricsOptions =
    WorkerBaseOptions<PipelineMetricsConfig>
    & WorkerSourceOptions<BlockSource>
    & WorkerDbOptions<PipelineMetricsDatabaseDependencies>;

export class PipelineMetrics {
    static async create(options: CreatePipelineMetricsOptions): Promise<PipelineMetrics> {
        const source = resolveEthersSource(options);
        const { dependencies, dispose } = await resolveDbDependencies<PipelineMetricsDatabaseDependencies>(
            options,
            (pool: Pool): PipelineMetricsDatabaseDependencies => ({
                chainCursorRepository: new PostgresChainCursorRepository(pool),
                blockJobsRepository: new PostgresBlockJobsRepository(pool),
                rawBlocksRepository: new PostgresRawBlocksRepository(pool),
                canonicalTransactionsRepository: new PostgresCanonicalTransactionsRepository(pool),
                canonicalEventsRepository: new PostgresCanonicalEventsRepository(pool),
                workerCursorsRepository: new PostgresWorkerCursorsRepository(pool),
            })
        );
        const service = new PipelineMetricsService(
            options.config,
            source,
            dependencies.chainCursorRepository,
            dependencies.blockJobsRepository,
            dependencies.rawBlocksRepository,
            dependencies.canonicalTransactionsRepository,
            dependencies.canonicalEventsRepository,
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

    async close(): Promise<void> {
        await this.dispose?.();
    }
}
