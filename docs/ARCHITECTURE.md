# Архитектура Voryn

## Назначение

Voryn — каркас индексатора для EVM-сетей, где подтвержденные данные обрабатываются строго по порядку блоков, а бизнес-логика вынесена в независимые воркеры реакций.

## Базовые принципы

- Источник истины: только канонически закоммиченные данные.
- Порядок блоков: только `N -> N+1` для каждой сети (`chain_id`).
- Изоляция: падение reaction-воркера не останавливает ingestion-контур.
- Singleton для критичных воркеров: через абстракцию `LeaderLock`.
- Срок хранения: очистка по TTL через отдельный retention-воркер.

## Слои кода

- `src/types` — модели домена и конфиги воркеров.
- `src/interfaces` — интерфейсы источников данных и хранилищ.
- `src/workers` — рабочие процессы (`PollingWorker` и `SingletonPollingWorker`).
- `src/sql/postgres-schema.sql` — базовая схема таблиц.

## Типы и конфиги

Этот слой фиксирует общий язык между источниками, воркерами и хранилищем:

- `types/chain.ts` — что именно приходит из сети и в каком виде это дальше сохранять:
  - `ChainBlock`, `ChainTransaction`, `ChainLog` — единый формат данных RPC.
  - `FetchedBlock` — результат одного запроса блока для fetch-воркера.
- `types/pipeline.ts` — внутренние записи, которые уже живут в БД и читаются воркерами:
  - `StreamType` — тип потока реакции (`event` | `tx`).
  - `BlockJobStatus` — статусы задания в очереди (`pending`, `fetching`, `fetched`, `committed`, `failed`).
  - `BlockJob` — запись очереди блока.
  - `RawBlockEnvelope` — структура сырого блока, который сохраняется после fetch-этапа.
  - `CanonicalEvent` / `CanonicalTransaction` — элементы канонических потоков реакций.
  - `WorkerCursor` — позиция конкретного реактора в потоке (`streamType`, `lastSeq`).
- `types/runtime.ts` — настройки, которые управляют поведением воркеров:
  - `IngestionConfig` — полный набор ingestion-настроек приложения.
  - `HeadWorkerConfig`, `FetchWorkerConfig`, `SequencerWorkerConfig`, `RetentionWorkerConfig` — узкие типы для конкретных ingestion-воркеров.
  - `ReactionConfig` — имя реактора, сеть, частота и размер батча.

## Интерфейсы

- `interfaces/block-source.ts` — получение head и блока с транзакциями.
- `interfaces/leader-lock.ts` — абстракция распределенной блокировки (`tryAcquire`, `release`).
- `interfaces/reaction.ts` — интерфейсы пользовательских обработчиков (`EventReactionHandler`, `TransactionReactionHandler`).
- `interfaces/stores.ts`:
  - `ChainCursorStore` — прогресс по сети.
  - `BlockJobQueueStore` — очередь блоков, claim/fail/retry метаданные.
  - `RawBlockStore` — сохранение сырых блоков.
  - `SequencerCommitStore` — последовательный канонический commit.
  - `EventStreamStore`, `TransactionStreamStore` — чтение подтвержденных/реакционных потоков.
  - `WorkerCursorStore` — курсоры реакторов.
  - `RetentionStore` — удаление старых данных по TTL.

## Ingestion-контур

### 1) `head-worker`

Файл: `workers/head-worker.ts`

- Читает `latest` у RPC.
- Считает `safeHead = latest - confirmations`.
- Добавляет диапазон job в `block_jobs` через `enqueueRange`.

### 2) `fetch-worker`

Файл: `workers/fetch-worker.ts`

- Берет job из `block_jobs` через `claimForFetch`.
- За один `tick` обрабатывает до `fetchBatchSize` job.
- Сохраняет сырой блок в `raw_blocks`.
- На ошибке вычисляет `nextRetryAt` по backoff-политике из `retry` и передает в `markFetchFailed`.

### 3) `sequencer-worker`

Файл: `workers/sequencer-worker.ts`

- Берет `lastCommittedBlock` из `chain_cursor`.
- Пытается закоммитить только следующий блок `N+1` через `commitNextBlock`.
- Именно этот шаг гарантирует строгий порядок подтвержденного потока.

### 4) `retention-worker`

Файл: `workers/retention-worker.ts`

- По `retention`-политике удаляет устаревшие данные:
  - `purge` (единая очистка по глубине блоков от `chain_cursor.last_committed_block`)

## Контур реакций

### `event-reaction-worker`

Файл: `workers/event-reaction-worker.ts`

- Читает `canonical_events` по `seq`.
- Обновляет курсор `worker_cursors(stream_type=event)`.
- Вызывает пользовательский `EventReactionHandler`.

### `transaction-reaction-worker`

Файл: `workers/transaction-reaction-worker.ts`

- Читает `canonical_transactions` по `seq`.
- Обновляет курсор `worker_cursors(stream_type=tx)`.
- Вызывает пользовательский `TransactionReactionHandler`.

## Оркестрация процессов

- Библиотека не содержит общего runtime-оркестратора.
- Один воркер = один процесс/контейнер.
- Координация процессов идет только через БД: `block_jobs`, `chain_cursor`, `worker_cursors`.
- `leaderLock` обязателен для singleton-воркеров:
  - `head`, `sequencer`, `retention`
  - `event-reaction`, `transaction-reaction`
- `fetch-worker` можно запускать в нескольких экземплярах (без singleton-lock).
- Правило singleton-старта: `tryAcquire() === false` -> `start()` завершается ошибкой; при `stop()` вызывается `release()`.

## Потоки данных и таблицы

- Очередь блоков: `block_jobs`.
- Сырые данные: `raw_blocks`.
- Канонические данные: `canonical_blocks`, `canonical_transactions`, `canonical_events`.
- Прогресс сети: `chain_cursor`.
- Курсоры реакторов: `worker_cursors`.

Подробная расшифровка полей: [DB_SCHEMA.md](/docs/DB_SCHEMA.md).
