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
- `src/interfaces` — contracts for domain entities, repositories, reactions, data sources, and infrastructure.
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

Public worker options are defined in `src/workers/*-worker.ts`, alongside each worker. Service configuration contracts are defined in `src/services/*-service.ts`, alongside each service. These contracts describe polling intervals, batch sizes, retry settings, and retention/reaction parameters. `src/runtime/options.ts` provides shared database and logger options for the `create(...)` factories.

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
- Computes the lower available-depth boundary: `floorBlock = max(0, latest - depthBlocks + 1)`.
- When no cursor exists, initializes `chain_cursor` and finishes the tick without enqueuing jobs:
  - without `initialBlock`, sets both block positions to `latest` and the committed hash to that block's hash,
  - with `initialBlock`, requires a safe integer in `[floorBlock, latest]`, sets both block positions to `initialBlock - 1`, and uses that block's `parentHash` as the committed hash; the next tick can enqueue starting with `initialBlock`,
  - an invalid `initialBlock` fails the tick without writing a cursor or jobs.
- An existing cursor takes precedence over `initialBlock`.
- If `last_committed_block < floorBlock - 1`, performs a rebase:
  - reads `floorBlock` from RPC and uses its `parentHash`,
  - moves `chain_cursor` to `floorBlock - 1` in a transaction,
  - deletes records up to that boundary from `block_jobs`, `blocks`, `transactions`, and `events`,
  - enqueues jobs in `[floorBlock, latest]`,
  - updates `lastEnqueuedBlock`,
  - finishes the tick.
- In one transaction:
  - reads the cursor,
  - enqueues jobs in `[max(lastEnqueuedBlock + 1, floorBlock), latest]`,
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
- If `parent_hash` differs from `last_committed_hash`, finds the common ancestor through `BlockSource`, deletes data
  after it, moves `chain_cursor` back to the ancestor, increments `reorg_version`, and atomically rewinds affected
  reaction cursors. Lagging reaction cursors keep their positions but receive the new version.

### `RetentionService`

`RetentionService` removes data outside the working retention depth relative to committed progress. It does not wait
for reactions to catch up.

- Locks the chain cursor during cleanup to coordinate with Head, reorg, and reaction history-gap updates.
- Computes the purge boundary in a transaction as `last_committed_block - retentionDepthBlocks`.
- Deletes data beyond the retention boundary from:
  - `block_jobs`
  - `blocks`
  - `transactions`
  - `events`

## Reaction Pipeline

The reaction pipeline runs user logic over data within the committed position. Each reaction worker tracks its own cursor, so handlers can fail and catch up independently.

### `ReactionService`

- Requires a non-negative safe integer `confirmations` for each reaction worker.
- Limits reads to `min(last_committed_block, last_enqueued_block - confirmations)`.
- Reads stream items in repository order: events use `(block_number, transaction_index, log_index)`, transactions use `(block_number, transaction_index)`.
- Tracks progress in `worker_cursors` with `stream_type = event` or `stream_type = transaction`.
- The event cursor stores `last_block_number`, `last_transaction_index`, `last_log_index`.
- The transaction cursor stores `last_block_number`, `last_transaction_index`, and the `-1` sentinel in `last_log_index`.
- On the first run for a new `workerName`, locks `chain_cursor` and initializes the cursor with the current committed
  position and `reorg_version`.
- Uses `blocksRepository.getOldestBlockNumber` once per tick to detect a cursor before available committed history.
- Rechecks a candidate gap under the chain cursor lock and saves `(firstAvailableBlock, -1, -1)` before the handler.
  After commit, logs `reaction_history_gap`; empty streams and confirmation waiting also account for gaps.
- When supplied, calls the synchronous `filter(item): boolean` outside business transactions, in stream order.
  Without a filter, all selected items are accepted.
  The filter checks the loaded item and returns `true` or `false` without writing to the database,
  making external requests or changing external state.
- Keeps one cursor: rejected items accumulate a position in memory and never call the handler. A fully rejected
  batch saves its final position with one conditional UPDATE. Pending skips are also
  checkpointed before propagating filter/handler errors. A failed checkpoint stops the tick.
- Calls `handler(item, db, workerName): Promise<void>` for each accepted item inside its own transaction.
  The configured reaction name is passed as the third argument. Handler SQL and cursor advancement use the same
  executor and commit together; counts and pending skips change only after commit. A rejected tail is saved
  with one checkpoint.
- Handler/cursor errors and version conflicts roll back the current item's SQL, preserving earlier commits.
  The executor lives only within the handler: await every query, do not retain or release it or control transactions.
- Saved rejected batches advance regularly without matches. Restart with the same cursor rescans only the unsaved
  batch tail, unless reorg or an intentional rewind changes the cursor. Initialization and history-gap accounting
  retain their infrastructure transactions.
- Atomicity applies only to SQL through the supplied executor. Other pools, HTTP effects and replay with a new
  cursor are outside the guarantee. Reorg does not compensate already committed application aggregates.
- Advances only when the cursor version still matches. A version conflict stops the current batch; the next tick reads
  the rewound state.

### Batch Preparation

`ReactionService.execute` loads the confirmed batch and passes it to `processItems`. An empty batch returns
before invoking prepare. For a nonempty batch, processItems awaits optional prepare and keeps its result in a local
variable shared by that attempt's filters and handlers. The context is neither stored in PostgreSQL nor carried
into the next tick.

Preparation precedes the item loop and runs outside business transactions. Its error exits before any item checkpoint;
cursor initialization or history-gap accounting already completed by execute is not rolled back.

After preparation, the service rereads `chain_cursor` and compares reorgVersion with the batch's version. A missing
cursor or changed version ends the attempt before filters and handlers. No additional read is needed without prepare.
This check avoids processing a batch invalidated during the external wait; it does not lock the chain for subsequent
processing. Each cursor write uses `advanceIfVersion`, so a later version conflict rolls back the accepted item's
SQL writes and stops the batch.

## Operational Tools

### `PipelineMetrics`

- Reads `latestBlock` from `BlockSource`.
- Returns lag for the `head`, `fetch`, and `sequencer` stages.
- Shows cursor/fetch freshness, `block_jobs` counters, failed blocks, and reaction worker lag by position.
- Collects all configured chains into one snapshot and one Prometheus document.

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
