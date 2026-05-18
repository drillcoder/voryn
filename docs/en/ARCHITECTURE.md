# Voryn Architecture

## Purpose

Voryn is an indexer framework for EVM networks.
The block processing pipeline enqueues blocks, fetches blocks with transactions and events into normalized tables,
and then advances the chain committed position in strict order. Reaction workers read data within that position and run user logic.

## Core Principles

- Source of truth for reaction workers: data within the chain committed position.
- Block order: commit only `N -> N+1` for each network (`chain_id`).
- The committed position is stored in `chain_cursor.last_committed_block` and `chain_cursor.last_committed_hash`.
- Block data is written by `FetchService`: `blocks`, `transactions`, and `events`.
- `SequencerWorker` is part of the block processing pipeline and controls committed-position ordering.
- The hot path should stay cheap: few joins, few mass updates, explicit range deletes.
- Separation of responsibilities:
  - repositories perform only simple database operations,
  - services describe one domain `tick` and its transaction boundaries,
  - workers handle polling/lifecycle, singleton locks, and dependency wiring.
- Reaction isolation: a reaction worker failure does not stop block processing.
- Singleton for critical workers: through `LeaderLock`.

## Code Layers

- `src/types` — base types (`ChainId`, `HashHex`, statuses, and so on).
- `src/interfaces` — contracts for domain entities, repositories, runtime configs, and infrastructure.
- `src/services` — one-`tick` domain logic for block processing, reactions, retention, metrics, and recovery.
- `src/repositories/postgres` — PostgreSQL repositories, grouped by table.
- `src/postgres` — PostgreSQL infrastructure (`LeaderLock`, `TransactionManager`, parsers).
- `src/workers` — lifecycle wrappers (`PollingWorker`, `SingletonPollingWorker`, block/reaction workers).
- `src/runtime` — helper types and resolvers for `create(...)` factories.
- `src/adapters` — adapters for external data sources, currently `EthersBlockSource`.
- `src/metrics` — public facade for pipeline state snapshots.
- `src/recovery` — public facade for manual failed block job recovery.
- `src/loggers` — ready-to-use `Logger` implementations.
- `src/sql/postgres-schema.sql` — table schema.

## Contracts and Models

`src/interfaces/pipeline.ts` describes pipeline domain entities at the application level: chain cursor, block queue jobs, stored blocks, transactions, events, reaction cursors, and retention purge result. This is the main data contract between workers and repositories.

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

## Block Processing

The block processing pipeline consists of `HeadWorker`, `FetchService`, `SequencerWorker`, and `RetentionService`.

### `HeadWorker`

`HeadWorker` tracks network height and enqueues blocks that should be fetched. It updates the queued boundary in `chain_cursor.last_enqueued_block`.

- Reads `latest` from `BlockSource`.
- On the first run, initializes `chain_cursor` with the current block.
- For regular operation, computes `safeHead = latest - confirmations`.
- Computes the lower available-depth boundary: `floorBlock = max(0, safeHead - depthBlocks + 1)`.
- If `last_committed_block < floorBlock - 1`, performs a rebase:
  - reads `floorBlock` from RPC and uses its `parentHash`,
  - moves `chain_cursor` to `floorBlock - 1` in a transaction,
  - deletes records up to that boundary from `block_jobs`, `blocks`, `transactions`, and `events`,
  - enqueues jobs in `[floorBlock, safeHead]`,
  - updates `lastEnqueuedBlock`,
  - finishes the tick.
- In one transaction:
  - reads the cursor,
  - enqueues jobs in `[max(lastEnqueuedBlock + 1, floorBlock), safeHead]`,
  - updates `lastEnqueuedBlock`.

### `FetchService`

`FetchService` processes the fetch queue. It claims a job, fetches the block with transactions and events, saves the data into tables, and moves the job to `fetched`.

- Claims jobs from `block_jobs` through `claimForFetch`.
- Supports stale-fetch recovery through `claimed_at` + TTL (`fetchClaimTtlMs`).
- For each job:
  - fetches the block from `BlockSource`,
  - saves the row to `blocks` in a transaction,
  - bulk-inserts `transactions` and `events`,
  - marks the job as `fetched`,
  - on failure, marks it as `failed` and sets `next_retry_at` with exponential backoff.

### `SequencerWorker`

`SequencerWorker` advances the chain committed position. It takes fetched blocks in strict order, checks the link to the previous committed block, and saves the new progress in `chain_cursor`.

- Commits up to `maxBlocksPerTick` sequential blocks per tick (`N+1`, `N+2`, ...).
- For each block in a transaction:
  - reads `chain_cursor`,
  - checks that the next job has status `fetched`,
  - reads the next block from `blocks`,
  - checks `parent_hash` against `last_committed_hash`,
  - advances `last_committed_*` in `chain_cursor`,
  - marks the job as `committed`.
- If `parent_hash` differs from `last_committed_hash`, finds the common ancestor through `BlockSource`,
  deletes data after it from `block_jobs`, `blocks`, `transactions`, `events`, and moves `chain_cursor` back to the ancestor.

### `RetentionService`

`RetentionService` removes data outside the working retention depth. It uses the committed position and reaction worker positions to keep data that is still needed for processing.

- Computes the purge boundary in a transaction as `last_committed_block - retentionDepthBlocks`.
- Deletes data beyond the retention boundary from:
  - `block_jobs`
  - `blocks`
  - `transactions`
  - `events`

## Reaction Pipeline

The reaction pipeline runs user logic over data within the committed position. Each reaction worker tracks its own cursor, so handlers can fail and catch up independently.

### `EventReactionService`

- Reads events from `events` in `(block_number, transaction_index, log_index)` order.
- Reads `chain_cursor.last_committed_block` before reading and limits the query to that boundary.
- Tracks progress in `worker_cursors` (`stream_type = event`).
- The cursor stores the latest processed position: `last_block_number`, `last_transaction_index`, `last_log_index`.
- On the first run for a new `workerName`, initializes the cursor with the current committed position.
- Calls the user-provided `EventReactionHandler`.

### `TransactionReactionService`

- Reads transactions from `transactions` in `(block_number, transaction_index)` order.
- Reads `chain_cursor.last_committed_block` before reading and limits the query to that boundary.
- Tracks progress in `worker_cursors` (`stream_type = tx`).
- The cursor stores the latest processed position: `last_block_number`, `last_transaction_index`.
- On the first run for a new `workerName`, initializes the cursor with the current committed position.
- Calls the user-provided `TransactionReactionHandler`.

## Operational Tools

### `PipelineMetrics`

- Reads `latestBlock` from `BlockSource`.
- Returns lag for the `head`, `fetch`, and `sequencer` stages.
- Shows cursor/fetch freshness, `block_jobs` counters, failed blocks, and reaction worker lag by position.

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
- Blocks: `blocks`
- Transactions: `transactions`
- Events: `events`
- Chain cursor: `chain_cursor`
- Reaction cursors: `worker_cursors`

Detailed schema: [DB_SCHEMA.md](./DB_SCHEMA.md)
