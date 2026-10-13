# Voryn

**A TypeScript library for reliable EVM indexing with PostgreSQL.**

<p align="center">
  <a href="https://www.npmjs.com/package/@drillcoder/voryn"><img alt="npm" src="https://img.shields.io/npm/v/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@drillcoder/voryn"><img alt="npm downloads" src="https://img.shields.io/npm/dm/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <a href="https://github.com/drillcoder/voryn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/drillcoder/voryn/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://codecov.io/gh/drillcoder/voryn"><img alt="test coverage" src="https://codecov.io/gh/drillcoder/voryn/branch/main/graph/badge.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.x-3178c6?style=flat-square">
  <img alt="ethers" src="https://img.shields.io/badge/ethers-v6-2535a0?style=flat-square">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-ready-4169e1?style=flat-square">
</p>

🇬🇧 English | [🇷🇺 Русский](./README.ru.md)

Voryn helps you build indexers that read blocks from EVM RPC, store normalized fetched data, commit chain progress in strict order, and run your application logic on transactions and events.

The library handles the boring but critical infrastructure: block queues, retries, cursors, singleton locks, reorg protection, retention, and metrics. You write business logic on top of committed data.

## Who it is for

Voryn is a good fit for teams building:

- backends for DeFi, NFT, payments, wallets, and on-chain analytics;
- event-driven services that react to contract logs;
- pipelines that load blocks, transactions, and events into PostgreSQL;
- application-owned custom indexers;
- multi-chain services where each chain needs isolated progress tracking.

Voryn focuses on durable PostgreSQL-backed indexing pipelines with application-owned storage and processing.

## What is included

- **Ingestion pipeline**: `HeadWorker` enqueues blocks, `FetchWorker` downloads data, and `SequencerWorker` commits only the strict `N -> N+1` sequence.
- **Reorg handling**: `parentHash` checks, common ancestor lookup, and rollback of replaced fetched data.
- **Horizontal fetch scaling**: multiple fetch workers can safely share one PostgreSQL-backed queue.
- **Durable reactions**: `EventReactionWorker` and `TransactionReactionWorker` read committed streams by block position and maintain their own cursors.
- **Operational tools**: `RetentionWorker`, `PipelineMetrics`, `BlockJobRecovery`, `ConsoleLogger`, and a PostgreSQL schema helper.
- **Replaceable pieces**: you can bring your own `BlockSource`, logger, repositories, transaction manager, or leader lock.

## How it works

```mermaid
flowchart LR
    RPC["EVM RPC"] --> Head["HeadWorker"]
    Head --> Jobs["block_jobs"]
    Jobs --> Fetch["FetchWorker x N"]
    Fetch --> Data["blocks / transactions / events"]
    Data --> Sequencer["SequencerWorker"]
    Jobs --> Sequencer
    Sequencer --> Cursor["chain_cursor"]
    Data --> Reactions["Reaction workers"]
    Cursor --> Reactions
```

- `Fetch` can be scaled horizontally. It writes normalized `blocks`, `transactions`, and `events`.
- `Sequencer` validates order through block hashes, advances `chain_cursor`, and marks the matching
`block_jobs` rows as committed.
- `Head`, `Sequencer`, `Retention`, and Reaction workers run as singleton processes through `LeaderLock`.

## Installation

```bash
npm install @drillcoder/voryn
```

The package is published as ESM and uses `ethers` v6 and `pg`.

## Database setup

Voryn expects the base PostgreSQL schema from the SQL file included in the npm package.

The physical file path after installation is:

```txt
node_modules/@drillcoder/voryn/dist/sql/postgres-schema.sql
```

The same file is also exposed as a package subpath:

```txt
@drillcoder/voryn/sql/postgres-schema.sql
```

You can apply the SQL with your own migration flow:

```bash
psql "$DATABASE_URL" -f node_modules/@drillcoder/voryn/dist/sql/postgres-schema.sql
```

Or use the built-in helper:

```ts
import { Pool } from "pg";
import { ConsoleLogger, applySqlFileToPostgresDb } from "@drillcoder/voryn";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = new ConsoleLogger({ minLevel: "info" });

await applySqlFileToPostgresDb({
    pool,
    sqlFilePath: "node_modules/@drillcoder/voryn/dist/sql/postgres-schema.sql",
    logger,
});

await pool.end();
```

Full example: [examples/db-apply-sql.ts](./examples/db-apply-sql.ts)

## Quick start

The minimal ingestion pipeline consists of `head`, `fetch`, and `sequencer`. In production, they are usually started as separate processes or containers.

```ts
import { FetchWorker, HeadWorker, SequencerWorker } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrls = ["https://rpc.example.org", "https://fallback-rpc.example.org"];
const chainId = 1;
const logLevel = "info";

const headOptions = {
    sourceConfig: {
        network: { chainId, rpcUrls },
        requestTimeoutMs: 5_000,
        operationTimeoutMs: 60_000,
    },
    delayBetweenTicksMs: 1_000,
    depthBlocks: 65_000,
    // initialBlock: 20_000_000, // first block on a new chain cursor
    logLevel,
    dbUrl,
};

const fetchOptions = {
    sourceConfig: {
        network: { chainId, rpcUrls },
        requestTimeoutMs: 30_000,
        operationTimeoutMs: 60_000,
    },
    delayBetweenTicksMs: 100,
    fetchBatchSize: 10,
    fetchConcurrency: 2,
    fetchClaimTtlMs: 125_000,
    retryMaxAttempts: 10,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 10_000,
    logLevel,
    dbUrl,
};

const sequencerOptions = {
    sourceConfig: {
        network: { chainId, rpcUrls },
        requestTimeoutMs: 5_000,
        operationTimeoutMs: 60_000,
    },
    delayBetweenTicksMs: 100,
    maxBlocksPerTick: 10,
    logLevel,
    dbUrl,
};

const head = await HeadWorker.create(headOptions);
const fetch = await FetchWorker.create(fetchOptions);
const sequencer = await SequencerWorker.create(sequencerOptions);

const handleSingletonFailure = (error: Error): void => {
    console.error(error);
    process.exitCode = 1;
};
head.onFailure(handleSingletonFailure);
sequencer.onFailure(handleSingletonFailure);

await Promise.all([
    head.start(),
    fetch.start(),
    sequencer.start(),
]);
```

Full worker examples:

- [HeadWorker](./examples/head-worker.ts)
- [FetchWorker](./examples/fetch-worker.ts)
- [SequencerWorker](./examples/sequencer-worker.ts)
- [RetentionWorker](./examples/retention-worker.ts)

## Event and transaction reactions

Reaction workers read only committed data. Each `workerName` has its own persisted cursor, so handlers can be
restarted safely.

```ts
import type { EventReactionHandler, EventReactionWorkerOptions } from "@drillcoder/voryn";
import { EventReactionWorker } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const logLevel = "info";

const handler: EventReactionHandler = async (event, db, workerName): Promise<void> => {
    console.info("event_received", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        logIndex: event.index,
        address: event.address,
    });

    await db.query(
        "INSERT INTO reaction_totals (worker_name, total) VALUES ($1, 1) "
        + "ON CONFLICT (worker_name) DO UPDATE SET total = reaction_totals.total + 1",
        [workerName]
    );
};

const options: EventReactionWorkerOptions = {
    chainId: 1,
    workerName: "contract-events",
    delayBetweenTicksMs: 500,
    batchSize: 1000,
    confirmations: 12,
    logLevel,
    dbUrl,
    filter: (event) => event.index === 10,
    handler,
};

const worker = await EventReactionWorker.create(options);

worker.onFailure((error) => {
    console.error(error);
    process.exitCode = 1;
});

await worker.start();
```

The example uses an application-owned `reaction_totals` table. Create it before starting the worker:

```sql
CREATE TABLE reaction_totals (worker_name text PRIMARY KEY, total bigint NOT NULL);
```

Both reaction workers support an optional synchronous `filter(item): boolean`. The filter checks the loaded item and
returns `true` or `false` without writing to the database, making external requests or changing external state.
Omit `filter` to accept every loaded item. A nonboolean filter result, including a Promise, causes an error.
A handler that returns early still commits progress in its business transaction; use a filter for cheap skips.
Rejected items never call the handler or open a business transaction. Their final position is saved
once at the end of each batch, or before propagating a filter/handler error. A fully rejected batch needs one
cursor UPDATE. Saved batches keep progress moving even during long periods without matches; after a failure,
only the unsaved tail needs scanning again, provided the same cursor is used and no reorg rewinds it.

Accepted items call `handler(item, db, workerName): Promise<void>`. The second argument is the current
transaction's `DbExecutor`; the third is the configured reaction name. A handler may declare only `(item, db)`.
Each accepted item commits its awaited SQL writes through `db` and its cursor together in one transaction.
Handler errors, cursor errors and reorg version conflicts roll back that item's writes; previous commits remain.
A version conflict stops the batch, and the next tick reads the current cursor. A successful item covers earlier
skips; only a later skipped tail requires a separate checkpoint.

Use `db` only within the handler and await every query before returning. Do not save it for later, release it,
or issue transaction control commands. HTTP calls and writes through other executors are outside this guarantee.
Handlers can be called again after rollback, retry or reorg. Reorg rewinds cursors but does not compensate
previously committed application aggregates. Removing a cursor or choosing a new `workerName` may replay data
and create additional effects. External effects need application-level idempotency.

`initialBlock` is optional for `HeadWorker` and both reaction workers. It is used only when their cursor is missing;
an existing cursor always resumes from its saved position. For `HeadWorker`, `initialBlock` must be within
`[max(0, latestBlock - depthBlocks + 1), latestBlock]`. The first head tick initializes the cursor; the next
enqueues blocks starting with `initialBlock`. An out-of-range value causes tick errors without creating a cursor or
jobs. Without `initialBlock`, a new `HeadWorker` cursor starts at the latest block and enqueues only later blocks.
A new reaction worker starts with items in the current committed block and skips earlier committed blocks.

Each reaction worker chooses its own non-negative safe integer `confirmations`. Its read boundary is the lower of committed
progress and `lastEnqueuedBlock - confirmations`. Retention does not wait for reaction workers, so configure:

```text
retentionDepthBlocks > max reaction confirmations + maximum expected processing lag + operational reserve
```

Examples:

- [EventReactionWorker](./examples/event-reaction-worker.ts)
- [TransactionReactionWorker](./examples/transaction-reaction-worker.ts)

### Batch preparation

`prepare(items)` lets you prepare shared data once for the entire batch, such as loading rules
from a database or external service. Voryn waits for preparation before processing items and passes
its result to `filter` and `handler` as the batch context.

Both `prepare` and `filter` are optional: the prepared data may be needed only by the handler.
The result type is inferred automatically; callback arguments include `undefined`, so the example
uses `?.` to check access to the address set.

```ts
const worker = await EventReactionWorker.create({
    chainId: 1,
    workerName: "prepared-events",
    delayBetweenTicksMs: 1000,
    batchSize: 100,
    confirmations: 12,
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    prepare: async (events) => new Set(events.map((event) => event.address)),
    filter: (event, addresses) => (addresses?.has(event.address) ?? false),
    handler: async (event, db, workerName, addresses) => {
        await db.query("SELECT $1, $2", [(addresses?.has(event.address) ?? false), workerName]);
    },
});
```

The example builds an address set locally; your prepare can instead load rules or other batch data from a database
or external service. Without prepare, context is undefined.

## Metrics and recovery

`PipelineMetrics` returns a pipeline snapshot: current RPC head, stage lag, data freshness, block job statuses, failed blocks, and reaction worker lag.

```ts
import { PipelineMetrics } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";

const metrics = await PipelineMetrics.create({
    dbUrl,
    sourceConfig: {
        networks: [
            {
                chainId: 1,
                rpcUrls: ["https://mainnet-rpc.example.org", "https://mainnet-fallback-rpc.example.org"],
            },
            {
                chainId: 56,
                rpcUrls: ["https://bsc-rpc.example.org", "https://bsc-fallback-rpc.example.org"],
            },
        ],
        requestTimeoutMs: 5_000,
        operationTimeoutMs: 60_000,
    },
});

const snapshot = await metrics.get();
const prometheusText = await metrics.getPrometheus();
await metrics.close();
```

- `get()` returns one aggregate snapshot with a `chains` array.
- `getPrometheus()` returns one Prometheus text document for all configured chains. Serve it from your own `/metrics` endpoint.

Use `BlockJobRecovery` to manually put failed blocks back into processing.

Examples:

- [Metrics](./examples/metrics.ts)
- [BlockJobRecovery](./examples/block-job-recovery.ts)

## RPC block source

The RPC branch of `sourceConfig` makes Voryn create and own an internal RPC-pool-backed `BlockSource`. The pool pins every
block-source operation to one endpoint. Eligible transport or endpoint-data failures retry the whole operation on
another endpoint. Fetch job retries are a separate pipeline-level recovery mechanism.

The internal adapter validates hashes, addresses, `data` fields, transaction indexes, and block number consistency.
To use another data source, implement the public `BlockSource` interface. For direct RPC pool access, use
`@drillcoder/ethers-rpc-pool`.

### Migrating to 1.1

Version 1.1 intentionally changes the source API. For a single-chain worker, replace top-level `chainId` plus
`rpcUrl`/`fallbackRpcUrl` with `sourceConfig: { network: { chainId, rpcUrls: [rpcUrl, fallbackRpcUrl] } }`. Move
`rpcRequestTimeoutMs` to `sourceConfig.requestTimeoutMs`; `sourceConfig.operationTimeoutMs` is the optional whole-operation
deadline. A custom source uses `sourceConfig: { chainId, source }`, without `network`. Replace direct
`EthersBlockSource` usage with one of these branches; for a custom integration, implement `BlockSource`.

For `PipelineMetrics`, use either `sourceConfig: { networks, requestTimeoutMs?, operationTimeoutMs? }` or
`sourceConfig: { chainIds, source }`. RPC metrics derive chain IDs from `networks`; custom metrics require `chainIds`.

## Public API

Import the supported public API from the package root, `@drillcoder/voryn`. Package-internal paths are not stable.

The public API is grouped by use case:

- pipeline workers: `HeadWorker`, `FetchWorker`, `SequencerWorker`, and `RetentionWorker`, with a corresponding
  `*Options` type for each `create()` factory;
- reactions: `EventReactionWorker`, `TransactionReactionWorker`, their `*Options` and handler types, and the
  `PipelineEvent` and `PipelineTransaction` records delivered to handlers;
- block sources: `BlockSource` and the chain data types needed to implement a custom source;
- operations: `PipelineMetrics`, `PipelineMetricsResult`, `BlockJobRecovery`, and their option and result types;
- logging: `Logger`, `noopLogger`, `ConsoleLogger`, and its configuration types;
- PostgreSQL infrastructure: repository interfaces and implementations, `LeaderLock`, `TransactionManager`,
  database executor types, and schema helpers.

The `*DatabaseDependencies` types describe the `overrides` accepted by factory options. They are useful when replacing
one or more PostgreSQL-backed dependencies. Other exported data types are the inputs and results of these public
extension points.

## Documentation

- [Architecture](./docs/en/ARCHITECTURE.md)
- [Database schema](./docs/en/DB_SCHEMA.md)
- [Operations](./docs/en/OPERATIONS.md)
- [Development](./docs/en/DEVELOPMENT.md)

## Development

Commands are collected in [dev/Makefile](./dev/Makefile). Checks that require project dependencies should be run through the `tools` container:

```bash
make lint
make test
make build
```

For the local development environment:

```bash
cp dev/.env.example dev/.env
make init
make ingestion-up
```
