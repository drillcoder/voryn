import type { ChainPipelineMetrics } from "../interfaces/metrics.js";

type PrometheusMetricValue = bigint | number;

interface PrometheusMetricDefinition {
    name: string;
    help: string;
}

export function formatPipelineMetricsPrometheus(metrics: ChainPipelineMetrics): string {
    const lines: string[] = [];
    const emittedDefinitions = new Set<string>();

    const addGauge = (
        definition: PrometheusMetricDefinition,
        value: PrometheusMetricValue | null,
        labels: Record<string, string> = {},
    ): void => {
        if (value === null) {
            return;
        }

        emitDefinition(lines, emittedDefinitions, definition);
        const formattedLabels = formatLabels({ chain_id: String(metrics.chainId), ...labels });

        lines.push(`${definition.name}${formattedLabels} ${formatValue(value)}`);
    };

    addGauge(
        {
            name: "voryn_pipeline_observed_timestamp_seconds",
            help: "Unix timestamp when the pipeline metrics snapshot was observed.",
        },
        dateToUnixSeconds(metrics.observedAt),
    );
    addGauge(
        {
            name: "voryn_pipeline_latest_block",
            help: "Latest block reported by the chain block source.",
        },
        metrics.latestBlock,
    );

    for (const [stage, stageMetrics] of [
        ["head", metrics.stages.head],
        ["fetch", metrics.stages.fetch],
        ["sequencer", metrics.stages.sequencer],
    ] as const) {
        addGauge(
            {
                name: "voryn_pipeline_stage_block",
                help: "Current block processed by a pipeline stage.",
            },
            stageMetrics.block,
            { stage },
        );
        addGauge(
            {
                name: "voryn_pipeline_stage_lag_blocks",
                help: "Pipeline stage lag from the latest block.",
            },
            stageMetrics.lagBlocks,
            { stage },
        );
    }

    addGauge(
        {
            name: "voryn_pipeline_freshness_seconds",
            help: "Seconds since the last pipeline progress timestamp.",
        },
        metrics.freshness.secondsSincePipelineUpdate,
        { source: "pipeline_update" },
    );
    addGauge(
        {
            name: "voryn_pipeline_freshness_seconds",
            help: "Seconds since the last pipeline progress timestamp.",
        },
        metrics.freshness.secondsSinceFetch,
        { source: "fetch" },
    );

    for (const status of ["pending", "fetching", "fetched", "committed", "failed"] as const) {
        addGauge(
            {
                name: "voryn_pipeline_block_jobs",
                help: "Number of block jobs by status.",
            },
            metrics.blockStatusCounts[status],
            { status },
        );
    }

    for (const failedBlock of metrics.failedBlocks) {
        const labels = { block: String(failedBlock.block) };

        addGauge(
            {
                name: "voryn_pipeline_failed_block_attempts",
                help: "Fetch attempts for recently failed blocks.",
            },
            failedBlock.attempts,
            labels,
        );
        addGauge(
            {
                name: "voryn_pipeline_failed_block_next_retry_timestamp_seconds",
                help: "Unix timestamp when a recently failed block can be retried.",
            },
            failedBlock.nextRetryAt === null ? null : dateToUnixSeconds(failedBlock.nextRetryAt),
            labels,
        );
        addGauge(
            {
                name: "voryn_pipeline_failed_block_updated_timestamp_seconds",
                help: "Unix timestamp when a recently failed block was last updated.",
            },
            dateToUnixSeconds(failedBlock.updatedAt),
            labels,
        );
    }

    for (const reaction of metrics.reactions) {
        const labels = {
            worker_name: reaction.workerName,
            stream_type: reaction.streamType,
        };

        addGauge(
            {
                name: "voryn_pipeline_reaction_processed_seq",
                help: "Last sequence processed by a reaction worker.",
            },
            reaction.processedSeq,
            labels,
        );
        addGauge(
            {
                name: "voryn_pipeline_reaction_target_seq",
                help: "Latest sequence available for a reaction worker stream.",
            },
            reaction.targetSeq,
            labels,
        );
        addGauge(
            {
                name: "voryn_pipeline_reaction_lag_seq",
                help: "Reaction worker sequence lag.",
            },
            reaction.lagSeq,
            labels,
        );
        addGauge(
            {
                name: "voryn_pipeline_reaction_seconds_since_progress",
                help: "Seconds since a reaction worker cursor moved.",
            },
            reaction.secondsSinceProgress,
            labels,
        );
    }

    return `${lines.join("\n")}\n`;
}

function emitDefinition(
    lines: string[],
    emittedDefinitions: Set<string>,
    definition: PrometheusMetricDefinition,
): void {
    if (emittedDefinitions.has(definition.name)) {
        return;
    }

    emittedDefinitions.add(definition.name);
    lines.push(`# HELP ${definition.name} ${definition.help}`);
    lines.push(`# TYPE ${definition.name} gauge`);
}

function formatLabels(labels: Record<string, string>): string {
    const values = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);

    return `{${values.join(",")}}`;
}

function escapeLabelValue(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll("\"", "\\\"");
}

function formatValue(value: PrometheusMetricValue): string {
    if (typeof value === "bigint") {
        return value.toString();
    }

    return String(value);
}

function dateToUnixSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}
