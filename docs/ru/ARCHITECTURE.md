# Архитектура Voryn

## Назначение

Voryn — каркас индексатора для EVM-сетей.  
Контур обработки блоков ставит блоки в очередь, скачивает блоки с транзакциями и событиями в нормализованные таблицы,
а затем строго по порядку продвигает committed-позицию цепи. Reaction-воркеры читают данные в пределах этой позиции и запускают пользовательскую логику.

## Базовые принципы

- Источник истины для reaction-воркеров: данные в пределах committed-позиции цепи.
- Порядок блоков: коммит только `N -> N+1` для каждой сети (`chain_id`).
- Committed-позиция хранится в `chain_cursor.last_committed_block` и `chain_cursor.last_committed_hash`.
- Данные блока пишет `FetchService`: `blocks`, `transactions` и `events`.
- `SequencerWorker` входит в контур обработки блоков и отвечает за порядок committed-позиции.
- Горячий путь должен быть дешевым: минимум join-ов, минимум массовых update-ов, явные delete по диапазонам.
- Разделение ответственности:
  - репозитории делают только простые операции с БД,
  - сервисы описывают один доменный `tick` и его транзакционные границы,
  - воркеры отвечают за polling/lifecycle, singleton-locks и wiring зависимостей.
- Изоляция реакций: падение reaction-воркера не останавливает обработку блоков.
- Singleton для критичных воркеров: через `LeaderLock`.

## Слои кода

- `src/types` — базовые типы (`ChainId`, `HashHex`, статусы и т.д.).
- `src/interfaces` — контракты доменных сущностей, репозиториев, runtime-конфигов и инфраструктуры.
- `src/services` — доменная логика одного `tick`: обработка блоков, reactions, retention, metrics и recovery.
- `src/repositories/postgres` — PostgreSQL-репозитории (по таблицам).
- `src/postgres` — PostgreSQL-инфраструктура (`LeaderLock`, `TransactionManager`, парсеры).
- `src/workers` — lifecycle-обертки (`PollingWorker`, `SingletonPollingWorker`, block/reaction воркеры).
- `src/runtime` — helper-типы и резолверы для `create(...)` фабрик.
- `src/adapters` — адаптеры внешних источников данных, сейчас `EthersBlockSource`.
- `src/metrics` — публичный facade для снимка состояния пайплайна.
- `src/recovery` — публичный facade для ручного восстановления failed block jobs.
- `src/loggers` — готовые реализации `Logger`.
- `src/sql/postgres-schema.sql` — схема таблиц.

## Контракты и модели

`src/interfaces/pipeline.ts` описывает доменные сущности пайплайна на уровне приложения: курсор цепочки, задания очереди блоков, сохраненные блоки, транзакции, события, курсоры реакторов и результат retention-очистки. Это основной контракт данных между воркерами и репозиториями.

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

## Обработка блоков

Контур обработки блоков состоит из `HeadWorker`, `FetchService`, `SequencerWorker` и `RetentionService`.

### `HeadWorker`

Следит за высотой сети и ставит в очередь блоки, которые должны быть загружены. Он обновляет границу поставленных задач в `chain_cursor.last_enqueued_block`.

- Получает `latest` из `BlockSource`.
- При первом запуске инициализирует `chain_cursor` текущим блоком.
- Для обычного хода считает `safeHead = latest - confirmations`.
- Считает нижнюю границу доступной глубины: `floorBlock = max(0, safeHead - depthBlocks + 1)`.
- Если `last_committed_block < floorBlock - 1`, выполняет rebase:
  - читает `floorBlock` из RPC и берет `parentHash`,
  - в транзакции сдвигает `chain_cursor` на `floorBlock - 1`,
  - удаляет записи до этой границы из `block_jobs`, `blocks`, `transactions` и `events`,
  - добавляет jobs в диапазоне `[floorBlock, safeHead]`,
  - обновляет `lastEnqueuedBlock`,
  - завершает тик.
- В одной транзакции:
  - читает cursor,
  - добавляет jobs в диапазоне `[max(lastEnqueuedBlock + 1, floorBlock), safeHead]`,
  - обновляет `lastEnqueuedBlock`.

### `FetchService`

Обрабатывает очередь загрузки. Он забирает job, скачивает блок с транзакциями и событиями, сохраняет данные в таблицы и переводит job в статус `fetched`.

- Забирает задачи из `block_jobs` через `claimForFetch`.
- Поддерживает recovery stale-fetch задач через `claimed_at` + TTL (`fetchClaimTtlMs`).
- Для каждой задачи:
  - тянет блок из `BlockSource`,
  - в транзакции сохраняет строку в `blocks`,
  - bulk-вставкой сохраняет `transactions` и `events`,
  - помечает job как `fetched`,
  - при ошибке ставит `failed` и `next_retry_at` с экспоненциальным backoff.

### `SequencerWorker`

Продвигает committed-позицию цепи. Он берет загруженные блоки строго по порядку, проверяет связь с предыдущим committed-блоком и фиксирует новый прогресс в `chain_cursor`.

- За тик коммитит до `maxBlocksPerTick` последовательных блоков (`N+1`, `N+2`, ...).
- Для каждого блока в транзакции:
  - читает `chain_cursor`,
  - проверяет, что следующий job имеет статус `fetched`,
  - берет следующий блок из `blocks`,
  - проверяет `parent_hash` против `last_committed_hash`,
  - двигает `last_committed_*` в `chain_cursor`,
  - помечает job как `committed`.
- Если `parent_hash` отличается от `last_committed_hash`, ищет общий предок через `BlockSource`,
  удаляет данные после него из `block_jobs`, `blocks`, `transactions`, `events` и возвращает `chain_cursor` к предку.

### `RetentionService`

Очищает данные за пределами рабочей глубины хранения. Он использует committed-позицию и позиции reaction-воркеров, чтобы оставить данные, которые еще нужны для обработки.

- В транзакции считает границу purge по `last_committed_block - retentionDepthBlocks`.
- Удаляет данные за границей retention из:
  - `block_jobs`
  - `blocks`
  - `transactions`
  - `events`

## Reaction-контур

Reaction-контур запускает пользовательскую логику по данным в пределах committed-позиции. Каждый reaction-воркер ведет свой cursor, поэтому обработчики могут падать и догонять поток независимо друг от друга.

### `EventReactionService`

- Читает события из `events` в порядке `(block_number, transaction_index, log_index)`.
- Перед чтением берет `chain_cursor.last_committed_block` и ограничивает выборку этой границей.
- Ведет прогресс в `worker_cursors` (`stream_type = event`).
- Cursor хранит последнюю обработанную позицию: `last_block_number`, `last_transaction_index`, `last_log_index`.
- При первом запуске нового `workerName` инициализирует cursor текущей committed-позицией.
- Вызывает пользовательский `EventReactionHandler`.

### `TransactionReactionService`

- Читает транзакции из `transactions` в порядке `(block_number, transaction_index)`.
- Перед чтением берет `chain_cursor.last_committed_block` и ограничивает выборку этой границей.
- Ведет прогресс в `worker_cursors` (`stream_type = tx`).
- Cursor хранит последнюю обработанную позицию: `last_block_number`, `last_transaction_index`.
- При первом запуске нового `workerName` инициализирует cursor текущей committed-позицией.
- Вызывает пользовательский `TransactionReactionHandler`.

## Операционные инструменты

### `PipelineMetrics`

- Читает `latestBlock` из `BlockSource`.
- Возвращает lag стадий `head`, `fetch`, `sequencer`.
- Показывает свежесть cursor/fetch, счетчики `block_jobs`, список failed-блоков и lag reaction-воркеров по позициям.

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
- Блоки: `blocks`
- Транзакции: `transactions`
- События: `events`
- Курсор цепочки: `chain_cursor`
- Курсоры реакторов: `worker_cursors`

Подробная схема: [DB_SCHEMA.md](./DB_SCHEMA.md)
