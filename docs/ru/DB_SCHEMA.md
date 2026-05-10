# Схема БД (поля таблиц)

Документ описывает поля из файла [postgres-schema.sql](../../src/sql/postgres-schema.sql).

## `chain_cursor`

Текущее состояние прогресса индексации по каждой сети.

- `chain_id` (`INT`, PK): числовой chain id.
- `last_enqueued_block` (`BIGINT`): до какого блока задания уже поставлены в `block_jobs`.
- `last_committed_block` (`BIGINT`): последний канонически подтвержденный блок.
- `last_committed_hash` (`VARCHAR(66)`): хэш последнего подтвержденного блока.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления строки.

## `block_jobs`

Очередь заданий по блокам.

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `status` (`TEXT`): статус задания (`pending`, `fetching`, `fetched`, `committed`, `failed`).
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

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `block_hash` (`VARCHAR(66)`): хэш блока.
- `parent_hash` (`VARCHAR(66)`): хэш родительского блока.
- `payload` (`JSONB`): сырой JSON блока/транзакций/логов.
- `fetched_at` (`TIMESTAMPTZ`): когда блок был скачан.

Ключи:
- PK: (`chain_id`, `block_number`)

## `canonical_blocks`

Подтвержденные (канонические) блоки.

- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока.
- `block_hash` (`VARCHAR(66)`): хэш канонического блока.
- `parent_hash` (`VARCHAR(66)`): хэш родителя.
- `block_timestamp` (`BIGINT`): timestamp блока из сети.
- `raw` (`JSONB`): сырой/нормализованный объект блока.

Ключи:
- PK: (`chain_id`, `block_number`)

## `canonical_transactions`

Подтвержденные транзакции с отдельным потоком `seq` для transaction-воркеров.

- `seq` (`BIGSERIAL`, PK): порядковый номер в transaction-потоке.
- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока транзакции.
- `block_hash` (`VARCHAR(66)`): хэш блока транзакции.
- `transaction_index` (`INT`): индекс транзакции внутри блока.
- `transaction_hash` (`VARCHAR(66)`): хэш транзакции.
- `from_address` (`VARCHAR(42)`): адрес отправителя.
- `to_address` (`VARCHAR(42)`, nullable): адрес получателя.
- `value` (`TEXT`): значение транзакции в wei, как строка.
- `data` (`TEXT`): calldata транзакции.
- `raw` (`JSONB`): сырой/нормализованный объект транзакции.

Ключи и индексы:
- PK: (`seq`)
- UNIQUE: (`chain_id`, `block_number`, `transaction_index`)
- Index: (`chain_id`, `seq`)

## `canonical_events`

Подтвержденные события (логи) с отдельным потоком `seq` для event-воркеров.

- `seq` (`BIGSERIAL`, PK): порядковый номер в event-потоке.
- `chain_id` (`INT`): сеть.
- `block_number` (`BIGINT`): номер блока события.
- `block_hash` (`VARCHAR(66)`): хэш блока события.
- `transaction_index` (`INT`): индекс транзакции в блоке.
- `transaction_hash` (`VARCHAR(66)`): хэш транзакции события.
- `log_index` (`INT`): индекс лога.
- `address` (`VARCHAR(42)`): адрес контракта, который эмитил лог.
- `topics` (`TEXT[]`): массив топиков события.
- `data` (`TEXT`): data события.
- `raw` (`JSONB`): сырой/нормализованный объект лога.

Ключи и индексы:
- PK: (`seq`)
- UNIQUE: (`chain_id`, `block_number`, `transaction_index`, `log_index`)
- Index: (`chain_id`, `seq`)

## `worker_cursors`

Курсоры реакторов по каждому потоку отдельно.

- `worker_name` (`TEXT`): имя воркера.
- `chain_id` (`INT`): сеть.
- `stream_type` (`TEXT`): тип потока, `event` или `tx`.
- `last_seq` (`BIGINT`): последний успешно обработанный `seq` для этого потока.
- `updated_at` (`TIMESTAMPTZ`): время последнего обновления курсора.

Ключи:
- PK: (`worker_name`, `chain_id`, `stream_type`)
