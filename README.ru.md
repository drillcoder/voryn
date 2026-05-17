# Voryn

<p align="center">
  <strong>TypeScript-каркас для надежной индексации EVM-сетей через PostgreSQL.</strong>
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
  <a href="./README.md">English documentation</a>
</p>

Voryn помогает строить индексаторы, которые читают блоки из EVM RPC, сохраняют нормализованные скачанные данные, последовательно коммитят каноническую цепочку и запускают пользовательские обработчики по транзакциям и событиям.

Библиотека закрывает скучную, но критичную инфраструктуру: очереди блоков, ретраи, курсоры, singleton-locks, защиту от reorg, retention и метрики. Вы пишете бизнес-логику поверх уже канонических данных.

## Для кого

Voryn подойдет командам, которые делают:

- backend для DeFi, NFT, payments, wallets и on-chain analytics;
- event-driven сервисы, которым нужно реагировать на логи контрактов;
- пайплайны для загрузки блоков, транзакций и событий в PostgreSQL;
- свои индексаторы вместо готовых hosted-решений;
- multi-chain сервисы, где прогресс каждой сети должен быть изолирован.

Не лучший выбор, если нужен разовый скрипт `getLogs`, полноценный query layer как у hosted indexer из коробки или хранение без PostgreSQL.

## Что внутри

- **Ingestion pipeline**: `HeadWorker` ставит блоки в очередь, `FetchWorker` скачивает данные, `SequencerWorker` коммитит только строгую последовательность `N -> N+1`.
- **Reorg handling**: проверка `parentHash`, поиск общего предка и откат неканонических данных.
- **Horizontal fetch scaling**: несколько fetch-воркеров могут безопасно делить одну очередь через PostgreSQL.
- **Durable reactions**: `EventReactionWorker` и `TransactionReactionWorker` читают канонические потоки по `seq` и ведут собственные курсоры.
- **Operational tools**: `RetentionWorker`, `PipelineMetrics`, `BlockJobRecovery`, `ConsoleLogger`, PostgreSQL schema helper.
- **Replaceable pieces**: можно подставить свой `BlockSource`, logger, repositories, transaction manager или leader lock.

## Как это работает

```mermaid
flowchart LR
    RPC["EVM RPC"] --> Head["HeadWorker"]
    Head --> Jobs["block_jobs"]
    Jobs --> Fetch["FetchWorker x N"]
    Fetch --> Raw["raw_blocks"]
    Raw --> Sequencer["SequencerWorker"]
    Sequencer --> Blocks["canonical_blocks"]
    Sequencer --> Txs["canonical_transactions"]
    Sequencer --> Events["canonical_events"]
    Txs --> TxReaction["TransactionReactionWorker"]
    Events --> EventReaction["EventReactionWorker"]
```

`fetch` можно масштабировать горизонтально. `head`, `sequencer`, `retention` и reaction-воркеры работают как singleton-процессы через `LeaderLock`.

## Установка

```bash
npm install @drillcoder/voryn
```

Пакет опубликован как ESM и использует `ethers` v6 и `pg`.

## Инициализация БД

Voryn ожидает базовую PostgreSQL-схему из `src/sql/postgres-schema.sql`.

Можно применить SQL своим способом:

```bash
psql "$DATABASE_URL" -f node_modules/@drillcoder/voryn/dist/sql/postgres-schema.sql
```

Или использовать helper:

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

Готовый пример: [examples/db-apply-sql.ts](./examples/db-apply-sql.ts)

## Быстрый старт

Минимальный ingestion-контур состоит из `head`, `fetch` и `sequencer`. В продакшене их обычно запускают отдельными процессами или контейнерами.

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

Полные примеры запуска:

- [HeadWorker](./examples/head-worker.ts)
- [FetchWorker](./examples/fetch-worker.ts)
- [SequencerWorker](./examples/sequencer-worker.ts)
- [RetentionWorker](./examples/retention-worker.ts)

## Реакции на события и транзакции

Reaction-воркеры читают только канонически закоммиченные данные. Каждый `workerName` имеет свой durable cursor, поэтому обработчик можно безопасно перезапускать.

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

Примеры:

- [EventReactionWorker](./examples/event-reaction-worker.ts)
- [TransactionReactionWorker](./examples/transaction-reaction-worker.ts)

## Метрики и recovery

`PipelineMetrics` дает снимок состояния пайплайна: текущий RPC head, отставание стадий, свежесть данных, статусы block jobs, failed-блоки и lag reaction-воркеров.

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

`get()` возвращает снимок состояния пайплайна как объект.
`getPrometheus()` возвращает метрики в Prometheus text exposition format. Его можно отдавать из своего
`/metrics` endpoint.

Для ручного возврата failed-блоков в обработку есть `BlockJobRecovery`.

Примеры:

- [Metrics](./examples/metrics.ts)
- [BlockJobRecovery](./examples/block-job-recovery.ts)

## EthersBlockSource

Из коробки есть адаптер для `ethers` v6:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "@drillcoder/voryn";

const source = new EthersBlockSource({
    provider: new JsonRpcProvider("https://rpc.example.org"),
    validateProviderChainId: true,
});
```

Адаптер валидирует chain id, хеши, адреса, `data`-поля, индексы транзакций и соответствие номера блока. Для другого источника данных достаточно реализовать интерфейс `BlockSource`.

## Публичный API

Основные экспорты:

- воркеры: `HeadWorker`, `FetchWorker`, `SequencerWorker`, `RetentionWorker`, `EventReactionWorker`, `TransactionReactionWorker`;
- данные и реакции: `CanonicalTransaction`, `CanonicalEvent`, `EventReactionHandler`, `TransactionReactionHandler`;
- инфраструктура: `EthersBlockSource`, `ConsoleLogger`, `PostgresLeaderLock`, `PostgresTransactionManager`;
- PostgreSQL-репозитории и schema helpers;
- операционные инструменты: `PipelineMetrics`, `BlockJobRecovery`.

## Документация

- [Архитектура](./docs/ru/ARCHITECTURE.md)
- [Схема БД](./docs/ru/DB_SCHEMA.md)
- [Разработка](./docs/ru/DEVELOPMENT.md)

## Разработка

Команды собраны в [dev/Makefile](./dev/Makefile). Так как проверки используют зависимости проекта, запускайте их через `tools`-контейнер:

```bash
make lint
make test
make build
```

Для локального dev-окружения:

```bash
cp dev/.env.example dev/.env
make init
make ingestion-up
```
