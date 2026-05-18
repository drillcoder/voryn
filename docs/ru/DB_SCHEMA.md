# Схема БД (поля таблиц)

Документ описывает поля из файла [postgres-schema.sql](../../src/sql/postgres-schema.sql).

## `chain_cursor`

Текущее состояние прогресса индексации по каждой сети.

- `chain_id` (`INT`, PK): числовой chain id.
- `last_enqueued_block` (`BIGINT`): до какого блока задания уже поставлены в `block_jobs`.
- `last_committed_block` (`BIGINT`): последний блок в committed-позиции.
- `last_committed_hash` (`VARCHAR(66)`): хэш последнего блока в committed-позиции.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления строки.

## `block_jobs`

Очередь заданий по блокам.

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `status` (`TEXT`): статус задания (`pending`, `fetching`, `fetched`, `committed`, `failed`).
- `attempts` (`INT`, default `0`): число попыток обработки.
- `next_retry_at` (`TIMESTAMPTZ`, nullable): когда job можно снова брать в работу после ошибки.
- `claimed_by` (`TEXT`, nullable): сгенерированный id инстанса fetch-воркера, который забрал задачу.
- `claimed_at` (`TIMESTAMPTZ`, nullable): когда задачу забрали.
- `error` (`TEXT`, nullable): текст последней ошибки.
- `updated_at` (`TIMESTAMPTZ`): время последнего изменения.

Ключи и индексы:
- PK: (`chain_id`, `block_number`)
- Index: (`chain_id`, `status`, `next_retry_at`, `block_number`)

## `blocks`

Сохраненные данные блока.

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `block_hash` (`VARCHAR(66)`): хэш блока.
- `parent_hash` (`VARCHAR(66)`): хэш родительского блока.
- `block_timestamp` (`BIGINT`): timestamp блока из сети.
- `fetched_at` (`TIMESTAMPTZ`): когда блок был скачан.

Ключи и индексы:
- PK: (`chain_id`, `block_number`)

## `transactions`

Сохраненные транзакции.

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока транзакции.
- `transaction_index` (`INT`): индекс транзакции внутри блока.
- `transaction_hash` (`VARCHAR(66)`): хэш транзакции.
- `from_address` (`VARCHAR(42)`): адрес отправителя.
- `to_address` (`VARCHAR(42)`, nullable): адрес получателя.
- `value` (`TEXT`): значение транзакции в wei, как строка.
- `data` (`TEXT`): calldata транзакции.

Ключи и индексы:
- PK: (`chain_id`, `block_number`, `transaction_index`)

## `events`

Сохраненные события (логи).

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока события.
- `transaction_index` (`INT`): индекс транзакции в блоке.
- `transaction_hash` (`VARCHAR(66)`): хэш транзакции события.
- `log_index` (`INT`): индекс лога.
- `address` (`VARCHAR(42)`): адрес контракта, который эмитил лог.
- `topics` (`TEXT[]`): массив топиков события.
- `data` (`TEXT`): data события.

Ключи и индексы:
- PK: (`chain_id`, `block_number`, `transaction_index`, `log_index`)

## `worker_cursors`

Курсоры реакторов по каждому потоку отдельно.

- `worker_name` (`TEXT`): имя воркера.
- `chain_id` (`INT`): сеть.
- `stream_type` (`TEXT`): тип потока, `event` или `tx`.
- `last_block_number` (`BIGINT`): номер последнего обработанного блока.
- `last_transaction_index` (`INT`): индекс последней обработанной транзакции.
- `last_log_index` (`INT`, nullable): индекс последнего обработанного лога. Используется для `event`, для `tx` остается `NULL`.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления курсора.

Ключи:
- PK: (`worker_name`, `chain_id`, `stream_type`)
