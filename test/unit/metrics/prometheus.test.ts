import type { ChainPipelineMetrics } from "../../../src/interfaces/metrics.js";
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
            processedSeq: 17n,
            targetSeq: 20n,
            lagSeq: 3n,
            secondsSinceProgress: 9,
        }],
    };

    expect(formatPipelineMetricsPrometheus(metrics)).toBe([
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
        "# HELP voryn_pipeline_failed_block_attempts Fetch attempts for recently failed blocks.",
        "# TYPE voryn_pipeline_failed_block_attempts gauge",
        "voryn_pipeline_failed_block_attempts{chain_id=\"7\",block=\"101\"} 4",
        "# HELP voryn_pipeline_failed_block_next_retry_timestamp_seconds "
            + "Unix timestamp when a recently failed block can be retried.",
        "# TYPE voryn_pipeline_failed_block_next_retry_timestamp_seconds gauge",
        "voryn_pipeline_failed_block_next_retry_timestamp_seconds{chain_id=\"7\",block=\"101\"} 1767225630",
        "# HELP voryn_pipeline_failed_block_updated_timestamp_seconds "
            + "Unix timestamp when a recently failed block was last updated.",
        "# TYPE voryn_pipeline_failed_block_updated_timestamp_seconds gauge",
        "voryn_pipeline_failed_block_updated_timestamp_seconds{chain_id=\"7\",block=\"101\"} 1767225603",
        "# HELP voryn_pipeline_reaction_processed_seq Last sequence processed by a reaction worker.",
        "# TYPE voryn_pipeline_reaction_processed_seq gauge",
        "voryn_pipeline_reaction_processed_seq{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 17",
        "# HELP voryn_pipeline_reaction_target_seq Latest sequence available for a reaction worker stream.",
        "# TYPE voryn_pipeline_reaction_target_seq gauge",
        "voryn_pipeline_reaction_target_seq{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 20",
        "# HELP voryn_pipeline_reaction_lag_seq Reaction worker sequence lag.",
        "# TYPE voryn_pipeline_reaction_lag_seq gauge",
        "voryn_pipeline_reaction_lag_seq{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 3",
        "# HELP voryn_pipeline_reaction_seconds_since_progress Seconds since a reaction worker cursor moved.",
        "# TYPE voryn_pipeline_reaction_seconds_since_progress gauge",
        "voryn_pipeline_reaction_seconds_since_progress"
            + "{chain_id=\"7\",worker_name=\"event-worker\",stream_type=\"event\"} 9",
        "",
    ].join("\n"));
});

test("omits nullable metrics when values are unknown", () => {
    const metrics: ChainPipelineMetrics = {
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

    const formatted = formatPipelineMetricsPrometheus(metrics);

    expect(formatted).not.toContain("voryn_pipeline_stage_block{");
    expect(formatted).not.toContain("voryn_pipeline_stage_lag_blocks{");
    expect(formatted).not.toContain("voryn_pipeline_freshness_seconds{");
});

test("escapes label values", () => {
    const metrics: ChainPipelineMetrics = {
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
        reactions: [{
            workerName: "worker\"one\\two\nthree",
            streamType: "tx",
            processedSeq: 1n,
            targetSeq: 2n,
            lagSeq: 1n,
            secondsSinceProgress: 5,
        }],
    };

    expect(formatPipelineMetricsPrometheus(metrics)).toContain(
        "worker_name=\"worker\\\"one\\\\two\\nthree\"",
    );
});
