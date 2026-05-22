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

Voryn помогает строить индексаторы, которые читают блоки из EVM RPC, сохраняют нормализованные скачанные данные, последовательно коммитят прогресс цепочки и запускают пользовательские обработчики по транзакциям и событиям.

Библиотека закрывает скучную, но критичную инфраструктуру: очереди блоков, ретраи, курсоры, singleton-locks, защиту от reorg, retention и метрики. Вы пишете бизнес-логику поверх уже закоммиченных данных.

## Для кого

Voryn подойдет командам, которые делают:

- backend для DeFi, NFT, payments, wallets и on-chain analytics;
- event-driven сервисы, которым нужно реагировать на логи контрактов;
- пайплайны для загрузки блоков, транзакций и событий в PostgreSQL;
- собственные индексаторы с контролем хранения и обработки;
- multi-chain сервисы, где прогресс каждой сети должен быть изолирован.

Voryn сфокусирован на надежных пайплайнах индексации с PostgreSQL, где хранение и обработка остаются на стороне приложения.

## Что внутри

- **Ingestion pipeline**: `HeadWorker` ставит блоки в очередь, `FetchWorker` скачивает данные, `SequencerWorker` коммитит только строгую последовательность `N -> N+1`.
- **Reorg handling**: проверка `parentHash`, поиск общего предка и откат замененных скачанных данных.
- **Horizontal fetch scaling**: несколько fetch-воркеров могут безопасно делить одну очередь через PostgreSQL.
- **Durable reactions**: `EventReactionWorker` и `TransactionReactionWorker` читают закоммиченные потоки по позиции блока и ведут собственные курсоры.
- **Operational tools**: `RetentionWorker`, `PipelineMetrics`, `BlockJobRecovery`, `ConsoleLogger`, PostgreSQL schema helper.
- **Replaceable pieces**: можно подставить свой `BlockSource`, logger, repositories, transaction manager или leader lock.

## Как это работает

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

- `Fetch` можно масштабировать горизонтально. Он пишет нормализованные `blocks`, `transactions` и `events`.
- `Sequencer` проверяет порядок через хеши блоков, двигает `chain_cursor` и помечает соответствующие строки
`block_jobs` как committed.
- `Head`, `Sequencer`, `Retention` и Reaction-воркеры работают как singleton-процессы через `LeaderLock`.

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
import { FetchWorker, HeadWorker, SequencerWorker } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const rpcUrl = "https://rpc.example.org";
const chainId = 1;
const logLevel = "info";

const headOptions = {
    config: {
        chainId,
        delayBetweenTicksMs: 1_000,
        confirmations: 12,
        depthBlocks: 65_000,
    },
    logLevel,
    dbUrl,
    rpcUrl,
};

const fetchOptions = {
    config: {
        chainId,
        delayBetweenTicksMs: 100,
        fetchBatchSize: 10,
        fetchConcurrency: 2,
        fetchClaimTtlMs: 125_000,
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 10_000,
    },
    logLevel,
    dbUrl,
    rpcUrl,
};

const sequencerOptions = {
    config: {
        chainId,
        delayBetweenTicksMs: 100,
        maxBlocksPerTick: 10,
    },
    logLevel,
    dbUrl,
    rpcUrl,
};

const head = await HeadWorker.create(headOptions);
const fetch = await FetchWorker.create(fetchOptions);
const sequencer = await SequencerWorker.create(sequencerOptions);

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

Reaction-воркеры читают только закоммиченные данные. У каждого `workerName` есть свой сохраняемый курсор, поэтому
обработчик можно безопасно перезапускать.

```ts
import type { CreateEventReactionWorkerOptions, EventReactionHandler, ReactionHandlerResult } from "@drillcoder/voryn";
import { EventReactionWorker } from "@drillcoder/voryn";

const dbUrl = "postgres://user:pass@localhost:5432/voryn";
const logLevel = "info";

const handler: EventReactionHandler = async (event): Promise<ReactionHandlerResult> => {
    console.info("event_received", {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        logIndex: event.index,
        address: event.address,
    });

    return event.index === 10 ? "processed" : "skipped";
};

const options: CreateEventReactionWorkerOptions = {
    config: {
        chainId: 1,
        workerName: "contract-events",
        delayBetweenTicksMs: 500,
        batchSize: 1000,
        skipFlushInterval: 100,
    },
    logLevel,
    dbUrl,
    handler,
};

const worker = await EventReactionWorker.create(options);

await worker.start();
```

Обработчик может вернуть `"processed"` или `"skipped"`. Для `"processed"` курсор двигается сразу. `"skipped"`
тоже считается безопасной позицией, но записи курсора группируются через `skipFlushInterval` и
сохраняются в конце прохода или перед повторным выбросом ошибки обработчика.

Обработчик может быть вызван повторно для того же элемента, если он упал до возврата результата или если воркер
остановился до сохранения курсора для этого элемента. Поэтому побочные эффекты обработчика должны быть
идемпотентными.

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

- `get()` возвращает снимок состояния пайплайна как объект.
- `getPrometheus()` возвращает метрики в Prometheus text exposition format. Его можно отдавать из своего `/metrics` endpoint.

Для ручного возврата failed-блоков в обработку есть `BlockJobRecovery`.

Примеры:

- [Metrics](./examples/metrics.ts)
- [BlockJobRecovery](./examples/block-job-recovery.ts)

## EthersBlockSource

Из коробки есть адаптер для `ethers` v6:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "@drillcoder/voryn";

const chainId = 1;
const logLevel = "info";
const provider = new JsonRpcProvider("https://rpc.example.org");

const source = new EthersBlockSource({
    providers: new Map([[chainId, provider]]),
    validateProviderChainId: true,
});
```

Ключ в `providers` — это `chainId`. На этом этапе одна сеть использует один provider.

Адаптер валидирует chain id, хеши, адреса, `data`-поля, индексы транзакций и соответствие номера блока. Для другого источника данных достаточно реализовать интерфейс `BlockSource`.

## Публичный API

Основные экспорты:

- воркеры: `HeadWorker`, `FetchWorker`, `SequencerWorker`, `RetentionWorker`, `EventReactionWorker`, `TransactionReactionWorker`;
- данные и реакции: `PipelineBlock`, `PipelineTransaction`, `PipelineEvent`, `EventReactionHandler`, `TransactionReactionHandler`;
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
