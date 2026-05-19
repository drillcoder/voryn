# Voryn

<p align="center">
  <strong>A TypeScript framework for reliable EVM indexing with PostgreSQL.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@drillcoder/voryn"><img alt="npm" src="https://img.shields.io/npm/v/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@drillcoder/voryn"><img alt="npm downloads" src="https://img.shields.io/npm/dm/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/%40drillcoder%2Fvoryn?style=flat-square"></a>
  <img alt="test coverage" src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square">
  <img alt="ethers" src="https://img.shields.io/badge/ethers-v6-2535a0?style=flat-square">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-ready-4169e1?style=flat-square">
</p>

<p align="center">
  <a href="./README.ru.md">Russian documentation</a>
</p>

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

Voryn expects the base PostgreSQL schema from `src/sql/postgres-schema.sql`.

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
import { ConsoleLogger, FetchWorker, HeadWorker, SequencerWorker } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";
const chainId = 1;
const logger = new ConsoleLogger({ minLevel: "info" });

const head = await HeadWorker.create({
    dbUrl,
    rpcUrl,
    logger,
    config: {
        chainId,
        delayBetweenTicksMs: 1_000,
        confirmations: 12,
        depthBlocks: 65_000,
    },
});

const fetch = await FetchWorker.create({
    dbUrl,
    rpcUrl,
    logger,
    config: {
        chainId,
        delayBetweenTicksMs: 100,
        fetchBatchSize: 10,
        fetchClaimTtlMs: 125_000,
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 10_000,
    },
});

const sequencer = await SequencerWorker.create({
    dbUrl,
    rpcUrl,
    logger,
    config: {
        chainId,
        delayBetweenTicksMs: 100,
        maxBlocksPerTick: 10,
    },
});

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

Reaction workers read only committed data. Each `workerName` has its own durable cursor, so handlers can be restarted safely.

```ts
import type { EventReactionHandler } from "@drillcoder/voryn";
import { ConsoleLogger, EventReactionWorker } from "@drillcoder/voryn";

const logger = new ConsoleLogger({ minLevel: "info" });

const handler: EventReactionHandler = {
    async handle(event): Promise<void> {
        logger.info("event_received", {
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.index,
            address: event.address,
        });
    },
};

const worker = await EventReactionWorker.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logger,
    handler,
    config: {
        chainId: 1,
        workerName: "contract-events",
        delayBetweenTicksMs: 1_000,
        batchSize: 250,
    },
});

await worker.start();
```

Examples:

- [EventReactionWorker](./examples/event-reaction-worker.ts)
- [TransactionReactionWorker](./examples/transaction-reaction-worker.ts)

## Metrics and recovery

`PipelineMetrics` returns a pipeline snapshot: current RPC head, stage lag, data freshness, block job statuses, failed blocks, and reaction worker lag.

```ts
import { PipelineMetrics } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";

const metrics = await PipelineMetrics.create({
    dbUrl,
    rpcUrl,
    config: { chainId: 1 },
});

const snapshot = await metrics.get();
const prometheusText = await metrics.getPrometheus();
await metrics.close();
```

- `get()` returns the pipeline snapshot as an object.
- `getPrometheus()` returns Prometheus text exposition format. Serve it from your own `/metrics` endpoint.

Use `BlockJobRecovery` to manually put failed blocks back into processing.

Examples:

- [Metrics](./examples/metrics.ts)
- [BlockJobRecovery](./examples/block-job-recovery.ts)

## EthersBlockSource

Voryn includes an adapter for `ethers` v6:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "@drillcoder/voryn";

const source = new EthersBlockSource({
    provider: new JsonRpcProvider("https://rpc.example.org"),
    validateProviderChainId: true,
});
```

The adapter validates chain id, hashes, addresses, `data` fields, transaction indexes, and block number consistency. To use another data source, implement the `BlockSource` interface.

## Public API

Main exports:

- workers: `HeadWorker`, `FetchWorker`, `SequencerWorker`, `RetentionWorker`, `EventReactionWorker`, `TransactionReactionWorker`;
- data and reactions: `PipelineBlock`, `PipelineTransaction`, `PipelineEvent`, `EventReactionHandler`, `TransactionReactionHandler`;
- infrastructure: `EthersBlockSource`, `ConsoleLogger`, `PostgresLeaderLock`, `PostgresTransactionManager`;
- PostgreSQL repositories and schema helpers;
- operational tools: `PipelineMetrics`, `BlockJobRecovery`.

## Documentation

- [Architecture](./docs/en/ARCHITECTURE.md)
- [Database schema](./docs/en/DB_SCHEMA.md)
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
