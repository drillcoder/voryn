# Voryn Architecture

## Purpose

Voryn is an indexer framework for EVM networks.
Ingestion workers collect and commit blocks in order, while reaction workers read already canonical data and run user logic.

## Core Principles

- Source of truth: only canonically committed data.
- Block order: commit only `N -> N+1` for each network (`chain_id`).
- Separation of responsibilities:
  - repositories perform only simple database operations,
  - services describe one domain `tick` and its transaction boundaries,
  - workers handle polling/lifecycle, singleton locks, and dependency wiring.
- Reaction isolation: a reaction worker failure does not stop the ingestion pipeline.
- Singleton for critical workers: through `LeaderLock`.

## Code Layers

- `src/types` — base types (`ChainId`, `HashHex`, statuses, and so on).
- `src/interfaces` — contracts for domain entities, repositories, runtime configs, and infrastructure.
- `src/services` — one-`tick` domain logic for ingestion, reactions, retention, metrics, and recovery.
- `src/repositories/postgres` — PostgreSQL repositories, grouped by table.
- `src/postgres` — PostgreSQL infrastructure (`LeaderLock`, `TransactionManager`, parsers).
- `src/workers` — lifecycle wrappers (`PollingWorker`, `SingletonPollingWorker`, ingestion/reaction workers).
- `src/runtime` — helper types and resolvers for `create(...)` factories.
- `src/adapters` — adapters for external data sources, currently `EthersBlockSource`.
- `src/metrics` — public facade for pipeline state snapshots.
- `src/recovery` — public facade for manual failed block job recovery.
- `src/loggers` — ready-to-use `Logger` implementations.
- `src/sql/postgres-schema.sql` — table schema.

## Contracts and Models

`src/interfaces/pipeline.ts` describes pipeline domain entities at the application level: chain cursor, block queue jobs, raw and canonical data, reaction cursors, and retention purge result. This is the main data contract between workers and repositories.

`src/types/pipeline.ts` defines limited pipeline types: reaction stream type and block job status. These types act as the shared state dictionary across all layers.

`src/interfaces/runtime.ts` contains worker configuration contracts. It groups parameters that control process behavior: `chainId`, polling intervals, batch sizes, retry settings, and retention/reaction worker parameters.

## Repositories

Repositories are described in `src/interfaces/repositories.ts`, with implementations in `src/repositories/postgres/*`.

Key rule:
- one repository = one database table,
- one method = one database action.

Repository methods accept an optional `transaction?: DbExecutor`, but they do not manage `BEGIN/COMMIT/ROLLBACK` themselves.

## Transactions

- Abstraction: `TransactionManager` (`src/interfaces/transaction-manager.ts`).
- PostgreSQL implementation: `PostgresTransactionManager` (`src/postgres/transaction-manager.ts`).
- Transaction logic is defined in services through `transactionManager.run(...)`.

This keeps business scenarios and transaction boundaries in one place.

## Ingestion Pipeline

### `HeadWorker`

- Reads `latest` from `BlockSource`.
- On the first run, initializes `chain_cursor` with the current block.
- For regular operation, computes `safeHead = latest - confirmations`.
- Computes the lower available-depth boundary: `floorBlock = max(0, safeHead - depthBlocks + 1)`.
- If `last_committed_block < floorBlock - 1`, performs a rebase:
  - reads `floorBlock` from RPC and uses its `parentHash`,
  - moves `chain_cursor` to `floorBlock - 1` in a transaction,
  - deletes old records up to that boundary from `block_jobs` and `raw_blocks`,
  - enqueues jobs in `[floorBlock, safeHead]`,
  - updates `lastEnqueuedBlock`,
  - finishes the tick.
- In one transaction:
  - reads the cursor,
  - enqueues jobs in `[max(lastEnqueuedBlock + 1, floorBlock), safeHead]`,
  - updates `lastEnqueuedBlock`.

### `FetchService`

- Claims jobs from `block_jobs` through `claimForFetch`.
- Supports stale-fetch recovery through `claimed_at` + TTL (`fetchClaimTtlMs`).
- For each job:
  - fetches the block from `BlockSource`,
  - saves it to `raw_blocks` and marks the job as `fetched` in a transaction,
  - on failure, marks it as `failed` and sets `next_retry_at` with exponential backoff.

### `SequencerWorker`

- Commits up to `maxBlocksPerTick` sequential blocks per tick (`N+1`, `N+2`, ...).
- For each block in a transaction:
  - reads `chain_cursor`,
  - reads the next block from `raw_blocks`,
  - checks `parent_hash` against `last_committed_hash`,
  - inserts data into `canonical_blocks`, `canonical_transactions`, `canonical_events`,
  - advances `last_committed_*` in `chain_cursor`,
  - marks the job as `committed`.
- If `parent_hash` does not match `last_committed_hash`, finds the common ancestor through `BlockSource`,
  deletes non-canonical data after it from `block_jobs`, `raw_blocks`, `canonical_blocks`,
  `canonical_transactions`, `canonical_events`, and moves `chain_cursor` back to the ancestor.

This worker is what guarantees strict ordering of the canonical stream.

### `RetentionService`

- Computes the purge boundary in a transaction as `last_committed_block - retentionDepthBlocks`.
- Deletes old data from:
  - `block_jobs`
  - `raw_blocks`
  - `canonical_blocks`
  - `canonical_transactions`
  - `canonical_events`

## Reaction Pipeline

### `EventReactionService`

- Reads events from `canonical_events` by `seq`.
- Tracks progress in `worker_cursors` (`stream_type = event`).
- On the first run for a new `workerName`, initializes the cursor with the current `maxSeq`, so it starts from new events rather than historical backfill.
- Calls the user-provided `EventReactionHandler`.

### `TransactionReactionService`

- Reads transactions from `canonical_transactions` by `seq`.
- Tracks progress in `worker_cursors` (`stream_type = tx`).
- On the first run for a new `workerName`, initializes the cursor with the current `maxSeq`, so it starts from new transactions rather than historical backfill.
- Calls the user-provided `TransactionReactionHandler`.

## Operational Tools

### `PipelineMetrics`

- Reads `latestBlock` from `BlockSource`.
- Returns lag for the `head`, `fetch`, and `sequencer` stages.
- Shows cursor/fetch freshness, `block_jobs` counters, failed blocks, and reaction worker lag.

### `BlockJobRecovery`

- Returns failed block jobs to processing for one block or a range.
- Resets attempts and sets `next_retry_at = NOW()` through `BlockJobsRepository.retryFailed(...)`.

## Process Orchestration

- One worker = one separate process/container.
- Processes coordinate only through the database.
- Singleton lock (`LeaderLock`) is required for:
  - `head`
  - `sequencer`
  - `retention`
  - `event-reaction`
  - `transaction-reaction`
- `fetch` can be scaled horizontally with multiple instances.

## Tables and Streams

- Block queue: `block_jobs`
- Raw blocks: `raw_blocks`
- Canonical blocks: `canonical_blocks`
- Canonical transactions: `canonical_transactions`
- Canonical events: `canonical_events`
- Chain cursor: `chain_cursor`
- Reaction cursors: `worker_cursors`

Detailed schema: [DB_SCHEMA.md](./DB_SCHEMA.md)
