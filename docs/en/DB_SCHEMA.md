# Database Schema

This document describes the fields from [postgres-schema.sql](../../src/sql/postgres-schema.sql).

## `chain_cursor`

Current indexing progress for each network.

- `chain_id` (`INT`, PK): numeric chain id.
- `last_enqueued_block` (`BIGINT`): the latest block for which jobs have been added to `block_jobs`.
- `last_committed_block` (`BIGINT`): the latest block in the committed position.
- `last_committed_hash` (`VARCHAR(66)`): hash of the latest block in the committed position.
- `updated_at` (`TIMESTAMPTZ`): last row update time.

## `block_jobs`

Block processing queue.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): block number.
- `status` (`TEXT`): job status (`pending`, `fetching`, `fetched`, `committed`, `failed`).
- `attempts` (`INT`, default `0`): number of processing attempts.
- `next_retry_at` (`TIMESTAMPTZ`, nullable): when the job can be picked up again after an error.
- `claimed_by` (`TEXT`, nullable): generated id of the fetch worker instance that claimed the job.
- `claimed_at` (`TIMESTAMPTZ`, nullable): when the job was claimed.
- `error` (`TEXT`, nullable): last error text.
- `updated_at` (`TIMESTAMPTZ`): last update time.

Keys and indexes:
- PK: (`chain_id`, `block_number`)
- Index: (`chain_id`, `status`, `next_retry_at`, `block_number`)

## `blocks`

Stored block data.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): block number.
- `block_hash` (`VARCHAR(66)`): block hash.
- `parent_hash` (`VARCHAR(66)`): parent block hash.
- `block_timestamp` (`BIGINT`): block timestamp from the network.
- `fetched_at` (`TIMESTAMPTZ`): when the block was fetched.

Keys and indexes:
- PK: (`chain_id`, `block_number`)

## `transactions`

Stored transactions.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): transaction block number.
- `transaction_index` (`INT`): transaction index inside the block.
- `transaction_hash` (`VARCHAR(66)`): transaction hash.
- `from_address` (`VARCHAR(42)`): sender address.
- `to_address` (`VARCHAR(42)`, nullable): recipient address.
- `value` (`TEXT`): transaction value in wei, as a string.
- `data` (`TEXT`): transaction calldata.

Keys and indexes:
- PK: (`chain_id`, `block_number`, `transaction_index`)

## `events`

Stored events/logs.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): event block number.
- `transaction_index` (`INT`): transaction index in the block.
- `transaction_hash` (`VARCHAR(66)`): event transaction hash.
- `log_index` (`INT`): log index.
- `address` (`VARCHAR(42)`): address of the contract that emitted the log.
- `topics` (`TEXT[]`): event topics.
- `data` (`TEXT`): event data.

Keys and indexes:
- PK: (`chain_id`, `block_number`, `transaction_index`, `log_index`)

## `worker_cursors`

Reaction cursors tracked separately for each stream.

- `worker_name` (`TEXT`): worker name.
- `chain_id` (`INT`): network.
- `stream_type` (`TEXT`): stream type, `event` or `tx`.
- `last_block_number` (`BIGINT`): latest processed block number.
- `last_transaction_index` (`INT`): latest processed transaction index.
- `last_log_index` (`INT`, nullable): latest processed log index. Used for `event`; remains `NULL` for `tx`.
- `updated_at` (`TIMESTAMPTZ`): last cursor update time.

Keys:
- PK: (`worker_name`, `chain_id`, `stream_type`)
