import type { ChainPipelineMetrics, PipelineMetricsResult } from "../interfaces/metrics.js";
import type { ChainId } from "../types/chain.js";

type PrometheusMetricValue = bigint | number;

interface PrometheusMetricDefinition {
    name: string;
    help: string;
}

export function formatPipelineMetricsPrometheus(metrics: PipelineMetricsResult): string {
    const lines: string[] = [];
    const emittedDefinitions = new Set<string>();

    const addGauge = (
        chainId: ChainId,
        definition: PrometheusMetricDefinition,
        value: PrometheusMetricValue | null,
        labels: Record<string, string> = {},
    ): void => {
        if (value === null) {
            return;
        }

        emitDefinition(lines, emittedDefinitions, definition);
        const formattedLabels = formatLabels({ chain_id: String(chainId), ...labels });

        lines.push(`${definition.name}${formattedLabels} ${formatValue(value)}`);
    };

    for (const chainMetrics of metrics.chains) {
        addPipelineMetricsGauges(chainMetrics, addGauge);
    }

    return `${lines.join("\n")}\n`;
}

function addPipelineMetricsGauges(
    metrics: ChainPipelineMetrics,
    addGauge: (
        chainId: ChainId,
        definition: PrometheusMetricDefinition,
        value: PrometheusMetricValue | null,
        labels?: Record<string, string>,
    ) => void,
): void {
    addGauge(
        metrics.chainId,
        {
            name: "voryn_pipeline_observed_timestamp_seconds",
            help: "Unix timestamp when the pipeline metrics snapshot was observed.",
        },
        dateToUnixSeconds(metrics.observedAt),
    );
    addGauge(
        metrics.chainId,
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
            metrics.chainId,
            {
                name: "voryn_pipeline_stage_block",
                help: "Current block processed by a pipeline stage.",
            },
            stageMetrics.block,
            { stage },
        );
        addGauge(
            metrics.chainId,
            {
                name: "voryn_pipeline_stage_lag_blocks",
                help: "Pipeline stage lag from the latest block.",
            },
            stageMetrics.lagBlocks,
            { stage },
        );
    }
    addGauge(
        metrics.chainId,
        {
            name: "voryn_pipeline_max_lag_blocks",
            help: "Maximum pipeline lag from fetch and sequencer stages.",
        },
        metrics.maxLag.blocks,
    );
    addGauge(
        metrics.chainId,
        {
            name: "voryn_pipeline_max_lag_seconds",
            help: "Maximum pipeline lag in seconds from fetch and sequencer stages.",
        },
        metrics.maxLag.seconds,
    );

    addGauge(
        metrics.chainId,
        {
            name: "voryn_pipeline_freshness_seconds",
            help: "Seconds since the last pipeline progress timestamp.",
        },
        metrics.freshness.secondsSincePipelineUpdate,
        { source: "pipeline_update" },
    );
    addGauge(
        metrics.chainId,
        {
            name: "voryn_pipeline_freshness_seconds",
            help: "Seconds since the last pipeline progress timestamp.",
        },
        metrics.freshness.secondsSinceFetch,
        { source: "fetch" },
    );

    for (const status of ["pending", "fetching", "fetched", "committed", "failed"] as const) {
        addGauge(
            metrics.chainId,
            {
                name: "voryn_pipeline_block_jobs",
                help: "Number of block jobs by status.",
            },
            metrics.blockStatusCounts[status],
            { status },
        );
    }

    for (const reaction of metrics.reactions) {
        const labels = {
            worker_name: reaction.workerName,
            stream_type: reaction.streamType,
        };

        addGauge(
            metrics.chainId,
            {
                name: "voryn_pipeline_reaction_block",
                help: "Current block processed by a reaction worker.",
            },
            reaction.block,
            labels,
        );
        addGauge(
            metrics.chainId,
            {
                name: "voryn_pipeline_reaction_lag_blocks",
                help: "Reaction worker block lag from the committed chain cursor.",
            },
            reaction.lagBlocks,
            labels,
        );
        addGauge(
            metrics.chainId,
            {
                name: "voryn_pipeline_reaction_seconds_since_progress",
                help: "Seconds since a reaction worker cursor moved.",
            },
            reaction.secondsSinceProgress,
            labels,
        );
    }
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
