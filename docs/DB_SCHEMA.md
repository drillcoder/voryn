# Схема БД (поля таблиц)

Документ описывает поля из файла [postgres-schema.sql](../src/sql/postgres-schema.sql).

## `chain_cursor`

Текущее состояние прогресса индексации по каждой сети.

- `chain_id` (`BIGINT`, PK): числовой chain id, например `1` (Ethereum), `56` (BSC).
- `last_enqueued_block` (`BIGINT`): до какого блока задания уже поставлены в `block_jobs`.
- `last_committed_block` (`BIGINT`): последний канонически подтвержденный блок.
- `last_committed_hash` (`TEXT`): хэш последнего подтвержденного блока.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления строки.

## `block_jobs`

Очередь заданий по блокам.

- `chain_id` (`BIGINT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `status` (`TEXT`): статус задания. Обычно: `pending`, `fetching`, `fetched`, `committed`, `failed`.
- `attempts` (`INT`, default `0`): число попыток обработки.
- `next_retry_at` (`TIMESTAMPTZ`, nullable): когда job можно снова брать в работу после ошибки.
- `claimed_by` (`TEXT`, nullable): id fetch-воркера, который забрал задачу.
- `claimed_at` (`TIMESTAMPTZ`, nullable): когда задачу забрали.
- `error` (`TEXT`, nullable): текст последней ошибки.
- `updated_at` (`TIMESTAMPTZ`): время последнего изменения.

Ключи и индексы:
- PK: (`chain_id`, `block_number`)
- Index: (`chain_id`, `status`, `next_retry_at`, `block_number`)

## `raw_blocks`

Сырые данные, скачанные из RPC до канонического коммита.

- `chain_id` (`BIGINT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `block_hash` (`TEXT`): хэш блока.
- `parent_hash` (`TEXT`): хэш родительского блока.
- `payload` (`JSONB`): сырой JSON блока/транзакций/логов.
- `fetched_at` (`TIMESTAMPTZ`): когда блок был скачан.

Ключи:
- PK: (`chain_id`, `block_number`)

## `canonical_blocks`

Подтвержденные (канонические) блоки.

- `chain_id` (`BIGINT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `block_hash` (`TEXT`): хэш канонического блока.
- `parent_hash` (`TEXT`): хэш родителя.
- `block_timestamp` (`BIGINT`): timestamp блока из сети.

Ключи:
- PK: (`chain_id`, `block_number`)

## `canonical_transactions`

Подтвержденные транзакции с отдельным потоком `seq` для tx-воркеров.

- `seq` (`BIGSERIAL`, PK): порядковый номер в tx-потоке.
- `chain_id` (`BIGINT`): сеть.
- `block_number` (`BIGINT`): номер блока транзакции.
- `tx_index` (`INT`): индекс транзакции внутри блока.
- `tx_hash` (`TEXT`): хэш транзакции.
- `payload` (`JSONB`): нормализованные/сырьевые данные транзакции.

Ключи и индексы:
- PK: (`seq`)
- UNIQUE: (`chain_id`, `block_number`, `tx_index`)
- Index: (`chain_id`, `seq`)

## `canonical_events`

Подтвержденные события (логи) с отдельным потоком `seq` для event-воркеров.

- `seq` (`BIGSERIAL`, PK): порядковый номер в event-потоке.
- `chain_id` (`BIGINT`): сеть.
- `block_number` (`BIGINT`): номер блока события.
- `tx_index` (`INT`): индекс транзакции в блоке.
- `log_index` (`INT`): индекс лога.
- `payload` (`JSONB`): данные события.

Индексы:
- UNIQUE: (`chain_id`, `block_number`, `tx_index`, `log_index`)
- Index: (`chain_id`, `seq`)

## `worker_cursors`

Курсоры реакторов по каждому потоку отдельно.

- `worker_name` (`TEXT`): имя воркера.
- `chain_id` (`BIGINT`): сеть.
- `stream_type` (`TEXT`): тип потока, `event` или `tx`.
- `last_seq` (`BIGINT`): последний успешно обработанный `seq` для этого потока.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления курсора.

Ключи:
- PK: (`worker_name`, `chain_id`, `stream_type`)
