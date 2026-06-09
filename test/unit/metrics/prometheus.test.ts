import type { ChainPipelineMetrics, PipelineMetricsResult } from "../../../src/interfaces/metrics.js";
import { formatPipelineMetricsPrometheus } from "../../../src/metrics/prometheus.js";

test("formats pipeline metrics as prometheus text", () => {
    const metrics: ChainPipelineMetrics = {
        chainId: 7,
        observedAt: new Date("2026-01-01T00:00:10.900Z"),
        latestBlock: 120,
        stages: {
            head: {
                block: 110,
                lagBlocks: 10,
            },
            fetch: {
                block: 104,
                lagBlocks: 16,
            },
            sequencer: {
                block: 100,
                lagBlocks: 20,
            },
        },
        maxLag: {
            blocks: 20,
            seconds: 80,
        },
        freshness: {
            secondsSincePipelineUpdate: 6,
            secondsSinceFetch: 3,
        },
        blockStatusCounts: {
            pending: 1,
            fetching: 2,
            fetched: 3,
            committed: 4,
            failed: 5,
        },
        failedBlocks: [{
            block: 101,
            attempts: 4,
            error: "rpc timeout",
            nextRetryAt: new Date("2026-01-01T00:00:30.000Z"),
            updatedAt: new Date("2026-01-01T00:00:03.000Z"),
        }],
        reactions: [{
            workerName: "event-worker",
            streamType: "event",
            block: 97,
            lagBlocks: 3,
            secondsSinceProgress: 9,
        }],
    };

    expect(formatPipelineMetricsPrometheus(createSnapshot([metrics]))).toBe([
        "# HELP voryn_pipeline_observed_timestamp_seconds "
            + "Unix timestamp when the pipeline metrics snapshot was observed.",
        "# TYPE voryn_pipeline_observed_timestamp_seconds gauge",
        "voryn_pipeline_observed_timestamp_seconds{chain_id=\"7\"} 1767225610",
        "# HELP voryn_pipeline_latest_block Latest block reported by the chain block source.",
        "# TYPE voryn_pipeline_latest_block gauge",
        "voryn_pipeline_latest_block{chain_id=\"7\"} 120",
        "# HELP voryn_pipeline_stage_block Current block processed by a pipeline stage.",
        "# TYPE voryn_pipeline_stage_block gauge",
        "voryn_pipeline_stage_block{chain_id=\"7\",stage=\"head\"} 110",
        "# HELP voryn_pipeline_stage_lag_blocks Pipeline stage lag from the latest block.",
        "# TYPE voryn_pipeline_stage_lag_blocks gauge",
        "voryn_pipeline_stage_lag_blocks{chain_id=\"7\",stage=\"head\"} 10",
        "voryn_pipeline_stage_block{chain_id=\"7\",stage=\"fetch\"} 104",
        "voryn_pipeline_stage_lag_blocks{chain_id=\"7\",stage=\"fetch\"} 16",
        "voryn_pipeline_stage_block{chain_id=\"7\",stage=\"sequencer\"} 100",
        "voryn_pipeline_stage_lag_blocks{chain_id=\"7\",stage=\"sequencer\"} 20",
        "# HELP voryn_pipeline_max_lag_blocks Maximum pipeline lag from fetch and sequencer stages.",
        "# TYPE voryn_pipeline_max_lag_blocks gauge",
        "voryn_pipeline_max_lag_blocks{chain_id=\"7\"} 20",
        "# HELP voryn_pipeline_max_lag_seconds Maximum pipeline lag in seconds from fetch and sequencer stages.",
        "# TYPE voryn_pipeline_max_lag_seconds gauge",
        "voryn_pipeline_max_lag_seconds{chain_id=\"7\"} 80",
        "# HELP voryn_pipeline_freshness_seconds Seconds since the last pipeline progress timestamp.",
        "# TYPE voryn_pipeline_freshness_seconds gauge",
        "voryn_pipeline_freshness_seconds{chain_id=\"7\",source=\"pipeline_update\"} 6",
        "voryn_pipeline_freshness_seconds{chain_id=\"7\",source=\"fetch\"} 3",
        "# HELP voryn_pipeline_block_jobs Number of block jobs by status.",
        "# TYPE voryn_pipeline_block_jobs gauge",
        "voryn_pipeline_block_jobs{chain_id=\"7\",status=\"pending\"} 1",
        "voryn_pipeline_block_jobs{chain_id=\"7\",status=\"fetching\"} 2",
        "voryn_pipeline_block_jobs{chain_id=\"7\",status=\"fetched\"} 3",
        "voryn_pipeline_block_jobs{chain_id=\"7\",status=\"committed\"} 4",
        "voryn_pipeline_block_jobs{chain_id=\"7\",status=\"failed\"} 5",
        "# HELP voryn_pipeline_reaction_block Current block processed by a reaction worker.",
        "# TYPE voryn_pipeline_reaction_block gauge",
        "voryn_pipeline_reaction_block"
            + "{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 97",
        "# HELP voryn_pipeline_reaction_lag_blocks Reaction worker block lag from the committed chain cursor.",
        "# TYPE voryn_pipeline_reaction_lag_blocks gauge",
        "voryn_pipeline_reaction_lag_blocks"
            + "{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 3",
        "# HELP voryn_pipeline_reaction_seconds_since_progress Seconds since a reaction worker cursor moved.",
        "# TYPE voryn_pipeline_reaction_seconds_since_progress gauge",
        "voryn_pipeline_reaction_seconds_since_progress"
            + "{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 9",
        "",
    ].join("\n"));
});

test("omits nullable metrics when values are unknown", () => {
    const metrics = createEmptyMetrics();

    const formatted = formatPipelineMetricsPrometheus(createSnapshot([metrics]));

    expect(formatted).not.toContain("voryn_pipeline_stage_block{");
    expect(formatted).not.toContain("voryn_pipeline_stage_lag_blocks{");
    expect(formatted).not.toContain("voryn_pipeline_max_lag_blocks{");
    expect(formatted).not.toContain("voryn_pipeline_max_lag_seconds{");
    expect(formatted).not.toContain("voryn_pipeline_freshness_seconds{");
});

test("omits failed block details from prometheus text", () => {
    const metrics: ChainPipelineMetrics = {
        ...createEmptyMetrics(),
        blockStatusCounts: {
            pending: 0,
            fetching: 0,
            fetched: 0,
            committed: 0,
            failed: 1,
        },
        failedBlocks: [{
            block: 11,
            attempts: 2,
            error: "rpc timeout",
            nextRetryAt: null,
            updatedAt: new Date("2026-01-01T00:00:05.000Z"),
        }],
    };

    const formatted = formatPipelineMetricsPrometheus(createSnapshot([metrics]));

    expect(formatted).toContain("voryn_pipeline_block_jobs{chain_id=\"1\",status=\"failed\"} 1");
    expect(formatted).not.toContain("voryn_pipeline_failed_block_");
    expect(formatted).not.toContain("block=\"11\"");
});

test("formats reaction block lag without cursor internals", () => {
    const metrics: ChainPipelineMetrics = {
        ...createEmptyMetrics(),
        reactions: [{
            workerName: "transaction-worker",
            streamType: "transaction",
            block: 9,
            lagBlocks: 1,
            secondsSinceProgress: 5,
        }],
    };

    const formatted = formatPipelineMetricsPrometheus(createSnapshot([metrics]));

    expect(formatted).toContain(
        "voryn_pipeline_reaction_block{chain_id=\"1\",worker_name=\"transaction-worker\",stream_type=\"transaction\"} 9"
    );
    expect(formatted).not.toContain("voryn_pipeline_reaction_position_transaction_index{");
    expect(formatted).not.toContain("voryn_pipeline_reaction_position_log_index{");
});

test("escapes label values", () => {
    const metrics: ChainPipelineMetrics = {
        ...createEmptyMetrics(),
        reactions: [{
            workerName: "worker\"one\\two\nthree",
            streamType: "transaction",
            block: 1,
            lagBlocks: 1,
            secondsSinceProgress: 5,
        }],
    };

    expect(formatPipelineMetricsPrometheus(createSnapshot([metrics]))).toContain(
        "worker_name=\"worker\\\"one\\\\two\\nthree\"",
    );
});

test("formats bigint metric values", () => {
    const metrics = createEmptyMetrics();
    Object.defineProperty(metrics, "latestBlock", { value: 10n });

    expect(formatPipelineMetricsPrometheus(createSnapshot([metrics]))).toContain(
        "voryn_pipeline_latest_block{chain_id=\"1\"} 10"
    );
});

test("formats many chain metrics with shared prometheus metadata", () => {
    const formatted = formatPipelineMetricsPrometheus(createSnapshot([
        createEmptyMetrics(),
        {
            ...createEmptyMetrics(),
            chainId: 2,
            latestBlock: 20,
        },
    ]));

    expect(formatted).toContain("voryn_pipeline_latest_block{chain_id=\"1\"} 10");
    expect(formatted).toContain("voryn_pipeline_latest_block{chain_id=\"2\"} 20");
    expect(formatted.match(/# TYPE voryn_pipeline_latest_block gauge/g)).toHaveLength(1);
});

function createEmptyMetrics(): ChainPipelineMetrics {
    return {
        chainId: 1,
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        latestBlock: 10,
        stages: {
            head: {
                block: null,
                lagBlocks: null,
            },
            fetch: {
                block: null,
                lagBlocks: null,
            },
            sequencer: {
                block: null,
                lagBlocks: null,
            },
        },
        maxLag: {
            blocks: null,
            seconds: null,
        },
        freshness: {
            secondsSincePipelineUpdate: null,
            secondsSinceFetch: null,
        },
        blockStatusCounts: {
            pending: 0,
            fetching: 0,
            fetched: 0,
            committed: 0,
            failed: 0,
        },
        failedBlocks: [],
        reactions: [],
    };
}

function createSnapshot(chains: ChainPipelineMetrics[]): PipelineMetricsResult {
    return {
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        chains,
    };
}
