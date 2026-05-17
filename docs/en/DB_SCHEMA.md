# Database Schema

This document describes the fields from [postgres-schema.sql](../../src/sql/postgres-schema.sql).

## `chain_cursor`

Current indexing progress for each network.

- `chain_id` (`INT`, PK): numeric chain id.
- `last_enqueued_block` (`BIGINT`): the latest block for which jobs have been added to `block_jobs`.
- `last_committed_block` (`BIGINT`): the latest canonically committed block.
- `last_committed_hash` (`VARCHAR(66)`): hash of the latest committed block.
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

## `raw_blocks`

Normalized fetched block data before canonical commit.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): block number.
- `block_hash` (`VARCHAR(66)`): block hash.
- `parent_hash` (`VARCHAR(66)`): parent block hash.
- `payload` (`JSONB`): normalized block/transaction/log payload.
- `fetched_at` (`TIMESTAMPTZ`): when the block was fetched.

Keys:
- PK: (`chain_id`, `block_number`)

## `canonical_blocks`

Confirmed canonical blocks.

- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): block number.
- `block_hash` (`VARCHAR(66)`): canonical block hash.
- `parent_hash` (`VARCHAR(66)`): parent hash.
- `block_timestamp` (`BIGINT`): block timestamp from the network.
Keys:
- PK: (`chain_id`, `block_number`)

## `canonical_transactions`

Confirmed transactions with a separate `seq` stream for transaction workers.

- `seq` (`BIGSERIAL`, PK): sequence number in the transaction stream.
- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): transaction block number.
- `block_hash` (`VARCHAR(66)`): transaction block hash.
- `transaction_index` (`INT`): transaction index inside the block.
- `transaction_hash` (`VARCHAR(66)`): transaction hash.
- `from_address` (`VARCHAR(42)`): sender address.
- `to_address` (`VARCHAR(42)`, nullable): recipient address.
- `value` (`TEXT`): transaction value in wei, as a string.
- `data` (`TEXT`): transaction calldata.
Keys and indexes:
- PK: (`seq`)
- UNIQUE: (`chain_id`, `block_number`, `transaction_index`)
- Index: (`chain_id`, `seq`)

## `canonical_events`

Confirmed events/logs with a separate `seq` stream for event workers.

- `seq` (`BIGSERIAL`, PK): sequence number in the event stream.
- `chain_id` (`INT`): network.
- `block_number` (`BIGINT`): event block number.
- `block_hash` (`VARCHAR(66)`): event block hash.
- `transaction_index` (`INT`): transaction index in the block.
- `transaction_hash` (`VARCHAR(66)`): event transaction hash.
- `log_index` (`INT`): log index.
- `address` (`VARCHAR(42)`): address of the contract that emitted the log.
- `topics` (`TEXT[]`): event topics.
- `data` (`TEXT`): event data.
Keys and indexes:
- PK: (`seq`)
- UNIQUE: (`chain_id`, `block_number`, `transaction_index`, `log_index`)
- Index: (`chain_id`, `seq`)

## `worker_cursors`

Reaction cursors tracked separately for each stream.

- `worker_name` (`TEXT`): worker name.
- `chain_id` (`INT`): network.
- `stream_type` (`TEXT`): stream type, `event` or `tx`.
- `last_seq` (`BIGINT`): latest successfully processed `seq` for this stream.
- `updated_at` (`TIMESTAMPTZ`): last cursor update time.

Keys:
- PK: (`worker_name`, `chain_id`, `stream_type`)
