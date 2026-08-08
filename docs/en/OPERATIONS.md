# Operations

This runbook explains how to run and maintain Voryn in a live system.
It focuses on process layout, startup order, scaling, monitoring, recovery, and common incidents.

For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For table fields, see [DB_SCHEMA.md](./DB_SCHEMA.md).

## Components

Run workers as separate processes or containers. Processes coordinate through PostgreSQL.

- `HeadWorker`: one instance per `chainId`.
- `FetchWorker`: one or more instances per `chainId`.
- `SequencerWorker`: one instance per `chainId`.
- `RetentionWorker`: one instance per `chainId`.
- Reaction workers: one instance per `workerName + chainId`.

`HeadWorker`, `SequencerWorker`, `RetentionWorker`, and reaction workers are singleton-style workers.
They use `LeaderLock`, so duplicate processes should not process the same singleton workload at the same time.
`FetchWorker` does not use a singleton lock and can be scaled horizontally.

Process runners must register `onFailure` before starting a singleton worker. The worker stops itself if its leader
lock is lost, while the listener must report the failure and set a non-zero process exit code so the process manager
can restart it.

```ts
worker.onFailure((error) => {
    console.error(error);
    process.exitCode = 1;
});

await worker.start();
```

## Startup Order

Use this order for a new environment:

1. Start PostgreSQL.
2. Apply the SQL schema from `src/sql/postgres-schema.sql`.
3. Start `HeadWorker`.
4. Start one or more `FetchWorker` processes.
5. Start `SequencerWorker`.
6. Start `RetentionWorker`.
7. Start reaction workers.

## Worker Options

Common options:

- `chainId`: numeric chain id for the worker.
- `delayBetweenTicksMs`: pause between worker ticks.
- `dbUrl`: PostgreSQL connection string, unless dependencies are provided through `overrides`.
- `logLevel` or `logger`: built-in log level or custom logger.
- `rpcConfig` or `source`: block source for `HeadWorker`, `FetchWorker`, and `SequencerWorker`. `rpcConfig`
  contains the required `rpcUrl` and an optional `fallbackRpcUrl`.
- `rpcRequestTimeoutMs`: timeout for one HTTP request to either configured RPC URL; defaults to `30_000`.

`HeadWorker`:

- `confirmations`: number of latest blocks to leave unprocessed before enqueuing.
- `depthBlocks`: maximum block window that `head` keeps available for enqueueing. If committed progress falls behind this window, `head` rebases to the available boundary.

`FetchWorker`:

- `fetchBatchSize`: maximum jobs claimed in one tick.
- `fetchConcurrency`: maximum block fetches processed in parallel by one worker process.
- `fetchClaimTtlMs`: time after which a stuck `fetching` job can be claimed again.
- `retryMaxAttempts`: maximum fetch attempts before a job stays `failed`.
- `retryBaseDelayMs`: initial retry delay after a fetch failure.
- `retryMaxDelayMs`: maximum retry delay after repeated fetch failures.

`SequencerWorker`:

- `maxBlocksPerTick`: maximum committed blocks per tick.

`RetentionWorker`:

- `retentionDepthBlocks`: number of committed blocks kept behind the current committed position.

`EventReactionWorker` and `TransactionReactionWorker`:

- `workerName`: stable reaction worker name. Together with `chainId` and stream type, it identifies the cursor and lock.
- `batchSize`: maximum stream items read in one tick.
- `skipFlushInterval`: how often skipped items flush cursor progress.
- `handler`: application callback for one event or transaction.

## Scaling and Tuning

Scale `fetch` first. The fetch queue lives in `block_jobs`, and multiple `FetchWorker` processes can claim jobs from
the same chain queue.

`FetchWorker` settings:

- Increase the number of `FetchWorker` processes when `fetch` lag grows and RPC/PostgreSQL still have capacity.
- Increase `fetchConcurrency` when one `FetchWorker` process is underused and the RPC provider allows more parallel requests.
- Increase `fetchBatchSize` when one `FetchWorker` tick is too small and workers spend too much time polling.
- Keep `fetchBatchSize >= fetchConcurrency` so one `FetchWorker` tick can feed all concurrent fetch slots.

`SequencerWorker` settings:

- Increase `maxBlocksPerTick` when fetched jobs are ready but `sequencer` lag keeps growing.

Use conservative values first. High `fetchConcurrency` or too many fetch processes can overload the RPC provider,
increase failed jobs, and make retries worse.

## Reaction Workers

Reaction workers run application logic over committed data:

- `EventReactionWorker` reads from `events`.
- `TransactionReactionWorker` reads from `transactions`.
- Each worker has its own cursor in `worker_cursors`.
- Cursor identity is `workerName + chainId + streamType`.

On the first start, a reaction worker creates its cursor at the current committed block. It does not process older
already committed data before that point. Keep `workerName` stable across restarts if the worker should continue from
the same cursor.

Each tick reads up to `batchSize` items after the saved cursor and no later than the current committed block. The
handler returns:

- `"processed"`: cursor is advanced after this item.
- `"skipped"`: item is intentionally skipped; cursor progress is flushed according to `skipFlushInterval` and at the end of the tick.

If the handler throws, the worker stops the current tick and keeps the cursor at the last flushed position. The same
item can be delivered again after restart or retry. Handlers must be idempotent, especially when they write to external
systems.

Important operational points:

- Reaction workers do not block `head`, `fetch`, or `sequencer`.
- A slow reaction worker increases reaction lag but block ingestion continues.
- Retention does not wait for reaction cursors, so reaction lag must stay below `retentionDepthBlocks`.
- Reorgs can cause the same transaction or event to be delivered again if it is committed again after rollback.

## Retention

`retentionDepthBlocks` is the number of committed blocks to keep behind the current committed position.
`RetentionWorker` deletes old rows from `block_jobs`, `blocks`, `transactions`, and `events` after data is outside the
retention window.

Choose a depth that covers:

- expected reaction lag;
- incident response time;
- expected reorg depth for the chain;
- RPC provider history limits;
- how long operators need old block data for debugging.

Too small a value is risky. If a reaction worker falls too far behind, old rows can become unavailable before the
handler processes them. Monitor reaction lag and keep `retentionDepthBlocks` comfortably above the largest expected
reaction lag.

Retention does not wait for reaction cursors before deleting old rows. Treat reaction lag as an operational limit that
must stay inside the retention window.

If reaction lag approaches retention depth, fix the lag first: pause retention if your deployment allows it, scale or
repair the reaction worker, and only then resume normal cleanup.

## Recovery

Use `BlockJobRecovery` when block jobs are in `failed` status and the cause has been fixed.
Common examples are a temporary RPC outage, a bad RPC response, or an operator mistake in provider configuration.

Retry one failed block:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryFailedBlock(123);
await recovery.close();
```

Retry a failed range:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryFailedRange(124, 130);
await recovery.close();
```

Retry all failed blocks:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryAllFailedBlocks();
await recovery.close();
```

Do not run manual recovery while the root cause is still active. If RPC is still returning errors, recovery will only
return the same jobs to failure. Also avoid manual recovery when the sequencer is handling a reorg; let the sequencer
finish rollback and let `head` enqueue the correct range again.

## Metrics

`PipelineMetrics` returns a snapshot in this shape:

```json
{
  "observedAt": "2026-05-30T10:00:00.000Z",
  "chains": [
    {
      "chainId": 1,
      "observedAt": "2026-05-30T10:00:00.000Z",
      "latestBlock": 1999950,
      "stages": {
        "head": { "block": 1999940, "lagBlocks": 10 },
        "fetch": { "block": 1999900, "lagBlocks": 50 },
        "sequencer": { "block": 1999880, "lagBlocks": 70 }
      },
      "maxLag": { "blocks": 70, "seconds": 840 },
      "freshness": {
        "secondsSincePipelineUpdate": 3,
        "secondsSinceFetch": 2
      },
      "blockStatusCounts": {
        "pending": 40,
        "fetching": 4,
        "fetched": 16,
        "committed": 1999800,
        "failed": 0
      },
      "failedBlocks": [
        {
          "block": 1999701,
          "attempts": 3,
          "error": "RPC timeout",
          "nextRetryAt": "2026-05-30T10:00:30.000Z",
          "updatedAt": "2026-05-30T09:59:50.000Z"
        }
      ],
      "reactions": [
        {
          "workerName": "contract-events",
          "streamType": "event",
          "block": 1999800,
          "lagBlocks": 80,
          "secondsSinceProgress": 5
        }
      ]
    }
  ]
}
```

Field notes:

- Top-level `observedAt`: when the whole snapshot was collected.
- `chains[]`: one metrics object per configured `chainId`.
- `latestBlock`: latest block reported by the configured block source.
- `stages.head`: current head stage block and lag from `latestBlock`.
- `stages.fetch`: current fetch stage block and lag from `latestBlock`.
- `stages.sequencer`: current sequencer stage block and lag from `latestBlock`.
- `maxLag`: maximum lag in blocks and seconds.
- `freshness`: seconds since the latest pipeline update and latest fetch progress.
- `blockStatusCounts`: counts of jobs in `pending`, `fetching`, `fetched`, `committed`, and `failed`.
- `failedBlocks`: recently failed blocks with attempts, last error, next retry time, and last update time.
- `reactions`: reaction worker cursors, lag from the committed chain cursor, and seconds since cursor progress.

Prometheus output includes these gauges:

- `voryn_pipeline_latest_block`
- `voryn_pipeline_stage_block`
- `voryn_pipeline_stage_lag_blocks`
- `voryn_pipeline_max_lag_blocks`
- `voryn_pipeline_max_lag_seconds`
- `voryn_pipeline_freshness_seconds`
- `voryn_pipeline_block_jobs`
- `voryn_pipeline_reaction_block`
- `voryn_pipeline_reaction_lag_blocks`
- `voryn_pipeline_reaction_seconds_since_progress`

Failed block details are available in the JSON snapshot only. Prometheus exposes failed job counts through `voryn_pipeline_block_jobs{status="failed"}`.

Healthy state usually looks like this:

- `head` lag is small for the chain and configured confirmations.
- `fetch` lag does not grow continuously and decreases when fetch workers have enough capacity.
- `sequencer` lag does not grow without bound.
- `failed` jobs do not accumulate.
- Reaction lag stays well below `retentionDepthBlocks`.
- Time since the last fetch or reaction progress does not keep growing while workers are running.

Alert when stage lag grows too much, failed jobs appear, progress timestamps stop updating, or reaction lag approaches `retentionDepthBlocks`.

## Common Problems

### RPC is unavailable

Symptoms:
- `head` cannot read latest block;
- `fetch` jobs move to `failed`;
- freshness grows;
- failed blocks show RPC errors.

Actions:
- check provider status, credentials, rate limits, and network access;
- reduce fetch concurrency if the RPC provider limits requests;
- switch to a healthy provider if available;
- use `BlockJobRecovery` only after the RPC issue is fixed.

### Many failed jobs

Symptoms:
- `blockStatusCounts.failed` grows;
- `failedBlocks` shows repeated attempts or similar errors.

Actions:
- inspect the failed block errors first;
- check whether failures are provider errors, schema/database errors, or bad block parsing;
- fix the root cause before recovery;
- retry one block first, then retry a range if the single block succeeds.

### Fetch is behind

Symptoms:
- `stages.fetch.lagBlocks` grows;
- many jobs are `pending`;
- RPC and PostgreSQL are not saturated.

Actions:
- add more `FetchWorker` processes;
- increase `fetchConcurrency` carefully;
- increase `fetchBatchSize` if workers poll too often;
- check RPC rate limits before scaling further.

### Sequencer does not move

Symptoms:
- `fetched` jobs exist, but `stages.sequencer.block` does not advance;
- `sequencer` lag grows.

Actions:
- check whether the next required block is missing or failed;
- inspect logs for `parent_hash` mismatch or rollback;
- confirm `maxBlocksPerTick` is not too low for the backlog;
- do not skip blocks manually, because the committed sequence must remain contiguous.

### Reaction handler fails

Symptoms:
- block processing continues, but one reaction lag grows;
- `secondsSinceProgress` grows;
- worker logs show handler errors.

Actions:
- fix the handler or its downstream dependency;
- keep handler side effects idempotent because the same item can be retried;
- confirm retention depth is large enough for the lag;
- restart the worker after fixing the issue.

### Retention deletes old data

Symptoms:
- old blocks, transactions, events, or jobs are no longer present;
- a delayed reaction cannot find old data.

Actions:
- compare reaction lag with `retentionDepthBlocks`;
- remember that the reaction cursor is not reset by retention; if old stream rows were deleted, the worker will continue from the next available row after its saved cursor and the deleted gap will not be replayed;
- increase retention depth for future data;
- treat the deleted gap as lost for that reaction worker in normal operation;
- if exact replay is required, plan a separate restore/rebuild procedure and stop or change retention first;
- do not set retention depth below operational recovery needs.

### Lock is already held

Symptoms:
- a singleton worker starts but does not do work;
- logs show that `LeaderLock` cannot be acquired.

Actions:
- check whether another process for the same chain and role is running;
- keep only one active singleton workload per chain;
- if a process died, wait for normal PostgreSQL advisory lock release through connection close;
- investigate stale infrastructure processes before restarting repeatedly.

## Reorg Behavior

`SequencerWorker` checks that the next fetched block links to the current committed position.
If the next block `parent_hash` does not match `chain_cursor.last_committed_hash`, the sequencer treats it as a reorg.

During reorg handling it:

- finds the common ancestor through `BlockSource`;
- moves `chain_cursor` back to that ancestor;
- deletes replaced data after the ancestor from `block_jobs`, `blocks`, `transactions`, and `events`;
- lets `head` enqueue the correct blocks again.

Reaction workers read only data inside the committed position. This keeps handlers away from fetched but uncommitted
blocks and reduces exposure to branch changes.

Transactions and events from rolled-back blocks can be delivered to reaction workers again if they are committed again
after the reorg. Keep reaction handlers idempotent and safe to run more than once for the same transaction or event.

## Production Checklist

- SQL schema from `src/sql/postgres-schema.sql` has been applied.
- `validatePostgresSchema` passes against the production database.
- Each chain has the expected worker set.
- `PipelineMetrics` is available to monitoring, for example through an application endpoint or exporter.
- Alerts cover stage lag, failed jobs, progress timestamps that stop updating, and reaction lag approaching `retentionDepthBlocks`.
- RPC provider has enough rate limits for configured fetch scale.
- `fetchConcurrency`, `fetchBatchSize`, and `maxBlocksPerTick` are set per chain according to RPC and PostgreSQL capacity.
- `retentionDepthBlocks` is larger than expected reaction lag and incident response needs.
- Reaction handlers are idempotent.
- Operator runbooks include how to retry one failed block and a failed range.
