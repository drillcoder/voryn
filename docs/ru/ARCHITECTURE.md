# Архитектура Voryn

## Назначение

Voryn — каркас индексатора для EVM-сетей.  
Ingestion-воркеры последовательно собирают и коммитят блоки, а reaction-воркеры читают уже канонические данные и запускают пользовательскую логику.

## Базовые принципы

- Источник истины: только канонически закоммиченные данные.
- Порядок блоков: коммит только `N -> N+1` для каждой сети (`chain_id`).
- Разделение ответственности:
  - репозитории делают только простые операции с БД,
  - сервисы описывают один доменный `tick` и его транзакционные границы,
  - воркеры отвечают за polling/lifecycle, singleton-locks и wiring зависимостей.
- Изоляция реакций: падение reaction-воркера не останавливает ingestion-контур.
- Singleton для критичных воркеров: через `LeaderLock`.

## Слои кода

- `src/types` — базовые типы (`ChainId`, `HashHex`, статусы и т.д.).
- `src/interfaces` — контракты доменных сущностей, репозиториев, runtime-конфигов и инфраструктуры.
- `src/services` — доменная логика одного `tick`: ingestion, reactions, retention, metrics и recovery.
- `src/repositories/postgres` — PostgreSQL-репозитории (по таблицам).
- `src/postgres` — PostgreSQL-инфраструктура (`LeaderLock`, `TransactionManager`, парсеры).
- `src/workers` — lifecycle-обертки (`PollingWorker`, `SingletonPollingWorker`, ingestion/reaction воркеры).
- `src/runtime` — helper-типы и резолверы для `create(...)` фабрик.
- `src/adapters` — адаптеры внешних источников данных, сейчас `EthersBlockSource`.
- `src/metrics` — публичный facade для снимка состояния пайплайна.
- `src/recovery` — публичный facade для ручного восстановления failed block jobs.
- `src/loggers` — готовые реализации `Logger`.
- `src/sql/postgres-schema.sql` — схема таблиц.

## Контракты и модели

`src/interfaces/pipeline.ts` описывает доменные сущности пайплайна на уровне приложения: курсор цепочки, задания очереди блоков, скачанные и канонические данные, курсоры реакторов и результат retention-очистки. Это основной контракт данных между воркерами и репозиториями.

`src/types/pipeline.ts` задает базовые ограниченные типы пайплайна: тип потока реакции и статус задания блока. Эти типы используются как единый словарь состояний во всех слоях.

`src/interfaces/runtime.ts` хранит контракты конфигурации воркеров. Здесь собраны параметры, которые управляют поведением процессов: `chainId`, интервалы опроса, размеры батчей, retry-настройки и параметры retention/reaction-воркеров.

## Репозитории

Репозитории описаны в `src/interfaces/repositories.ts`, реализации — в `src/repositories/postgres/*`.

Ключевое правило:
- один репозиторий = одна таблица БД,
- один метод = одно действие с БД.

Методы репозиториев принимают необязательный `transaction?: DbExecutor`, но сами не управляют `BEGIN/COMMIT/ROLLBACK`.

## Транзакции

- Абстракция: `TransactionManager` (`src/interfaces/transaction-manager.ts`).
- PostgreSQL-реализация: `PostgresTransactionManager` (`src/postgres/transaction-manager.ts`).
- Транзакционная логика задается в сервисах через `transactionManager.run(...)`.

Это позволяет держать бизнес-сценарии и транзакционные границы в одном месте.

## Ingestion-контур

### `HeadWorker`

- Получает `latest` из `BlockSource`.
- При первом запуске инициализирует `chain_cursor` текущим блоком.
- Для обычного хода считает `safeHead = latest - confirmations`.
- Считает нижнюю границу доступной глубины: `floorBlock = max(0, safeHead - depthBlocks + 1)`.
- Если `last_committed_block < floorBlock - 1`, выполняет rebase:
  - читает `floorBlock` из RPC и берет `parentHash`,
  - в транзакции сдвигает `chain_cursor` на `floorBlock - 1`,
  - удаляет старые записи до этой границы из `block_jobs` и `raw_blocks`,
  - добавляет jobs в диапазоне `[floorBlock, safeHead]`,
  - обновляет `lastEnqueuedBlock`,
  - завершает тик.
- В одной транзакции:
  - читает cursor,
  - добавляет jobs в диапазоне `[max(lastEnqueuedBlock + 1, floorBlock), safeHead]`,
  - обновляет `lastEnqueuedBlock`.

### `FetchService`

- Забирает задачи из `block_jobs` через `claimForFetch`.
- Поддерживает recovery stale-fetch задач через `claimed_at` + TTL (`fetchClaimTtlMs`).
- Для каждой задачи:
  - тянет блок из `BlockSource`,
  - в транзакции сохраняет `raw_blocks` и помечает job как `fetched`,
  - при ошибке ставит `failed` и `next_retry_at` с экспоненциальным backoff.

### `SequencerWorker`

- За тик коммитит до `maxBlocksPerTick` последовательных блоков (`N+1`, `N+2`, ...).
- Для каждого блока в транзакции:
  - читает `chain_cursor`,
  - берёт следующий блок из `raw_blocks`,
  - проверяет `parent_hash` против `last_committed_hash`,
  - вставляет данные в `canonical_blocks`, `canonical_transactions`, `canonical_events`,
  - двигает `last_committed_*` в `chain_cursor`,
  - помечает job как `committed`.
- Если `parent_hash` не совпал с `last_committed_hash`, ищет общий предок через `BlockSource`,
  удаляет неканонические данные после него из `block_jobs`, `raw_blocks`, `canonical_blocks`,
  `canonical_transactions`, `canonical_events` и возвращает `chain_cursor` к предку.

Именно этот воркер обеспечивает строгий порядок канонического потока.

### `RetentionService`

- В транзакции считает границу purge по `last_committed_block - retentionDepthBlocks`.
- Удаляет старые данные из:
  - `block_jobs`
  - `raw_blocks`
  - `canonical_blocks`
  - `canonical_transactions`
  - `canonical_events`

## Reaction-контур

### `EventReactionService`

- Читает события из `canonical_events` по `seq`.
- Ведет прогресс в `worker_cursors` (`stream_type = event`).
- При первом запуске нового `workerName` инициализирует cursor текущим `maxSeq`, поэтому начинает с новых событий, а не с исторического backfill.
- Вызывает пользовательский `EventReactionHandler`.

### `TransactionReactionService`

- Читает транзакции из `canonical_transactions` по `seq`.
- Ведет прогресс в `worker_cursors` (`stream_type = tx`).
- При первом запуске нового `workerName` инициализирует cursor текущим `maxSeq`, поэтому начинает с новых транзакций, а не с исторического backfill.
- Вызывает пользовательский `TransactionReactionHandler`.

## Операционные инструменты

### `PipelineMetrics`

- Читает `latestBlock` из `BlockSource`.
- Возвращает lag стадий `head`, `fetch`, `sequencer`.
- Показывает свежесть cursor/fetch, счетчики `block_jobs`, список failed-блоков и lag reaction-воркеров.

### `BlockJobRecovery`

- Возвращает failed block jobs в обработку для одного блока или диапазона.
- Сбрасывает attempts и выставляет `next_retry_at = NOW()` через `BlockJobsRepository.retryFailed(...)`.

## Оркестрация процессов

- Один воркер = один отдельный процесс/контейнер.
- Координация процессов только через БД.
- Singleton-lock (`LeaderLock`) нужен для:
  - `head`
  - `sequencer`
  - `retention`
  - `event-reaction`
  - `transaction-reaction`
- `fetch` можно масштабировать горизонтально (несколько экземпляров).

## Таблицы и потоки

- Очередь блоков: `block_jobs`
- Сырые блоки: `raw_blocks`
- Канонические блоки: `canonical_blocks`
- Канонические транзакции: `canonical_transactions`
- Канонические события: `canonical_events`
- Курсор цепочки: `chain_cursor`
- Курсоры реакторов: `worker_cursors`

Подробная схема: [DB_SCHEMA.md](./DB_SCHEMA.md)
