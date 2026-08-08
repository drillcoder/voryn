# Development

Development commands are collected in `dev/Makefile`.
There is a proxy `Makefile` in the repository root, so you can run commands like `make lint`, `make test`, and `make init`.

Main commands:

- `make install` — install dependencies in the `tools` container.
- `make build` — build the package.
- `make build-test` — type-check test compilation.
- `make lint` — run ESLint.
- `make test` — run unit tests.
- `make test-all` — run the full Jest suite.
- `make test-coverage` — run tests with coverage.

## Docker (dev)

For docker-compose, `VORYN_CHAIN_ID` is required (`is required`), and RPC variables are required per worker:
`VORYN_HEAD_RPC_URL`, `VORYN_FETCH_RPC_URL`.
They are read from the environment.
Start with `dev/.env.example`:

```bash
cp dev/.env.example dev/.env
```

Start workers:

```bash
docker compose --env-file dev/.env -f dev/docker-compose.yml up -d postgres head fetch sequencer retention
```

Logs:

```bash
docker compose --env-file dev/.env -f dev/docker-compose.yml logs -f head fetch sequencer retention
```

## Running Block Processing Workers

Use the dev scripts:

- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/head.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/fetch.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/sequencer.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/retention.ts`

Main environment variables:

- `DATABASE_URL` (`required`) — PostgreSQL connection string.
- `VORYN_CHAIN_ID` (`required`) — numeric network id for block processing.
- `VORYN_LOG_LEVEL` (`optional`, `debug` | `info` | `warn` | `error`, default `info`) — minimum log level.

For `head`:

- `VORYN_HEAD_RPC_URL` (`required`) — RPC URL for reading the current network head.
- `VORYN_HEAD_FALLBACK_RPC_URL` (`required`) — fallback RPC URL used on an error.
- `VORYN_HEAD_RPC_REQUEST_TIMEOUT_MS` (`optional`, default `5_000`) — timeout for one HTTP RPC request.
- `VORYN_HEAD_DELAY_BETWEEN_TICKS_MS` (`optional`, default `1_000`) — delay between ticks in milliseconds.
- `VORYN_HEAD_CONFIRMATIONS` (`optional`, default `0`) — number of confirmations before enqueuing a block.
- `VORYN_HEAD_DEPTH_BLOCKS` (`optional`, default `65_000`, must be `> 0`) — allowed lag from `safe head` in blocks. If `last_committed_block` falls below this range, `head` rebases to the available RPC history boundary.

For `fetch`:

- `VORYN_FETCH_RPC_URL` (`required`) — RPC URL for loading block data.
- `VORYN_FETCH_FALLBACK_RPC_URL` (`required`) — fallback RPC URL used on an error.
- `VORYN_FETCH_RPC_REQUEST_TIMEOUT_MS` (`optional`, default `30_000`) — timeout for one HTTP RPC request.
- `VORYN_FETCH_DELAY_BETWEEN_TICKS_MS` (`optional`, default `100`) — delay between ticks in milliseconds.
- `VORYN_FETCH_BATCH_SIZE` (`optional`, default `10`) — maximum jobs per `tick`.
- `VORYN_FETCH_CONCURRENCY` (`optional`, default `1`) — maximum jobs that `fetch` processes concurrently.
- `VORYN_FETCH_CLAIM_TTL_MS` (`optional`, default `125_000`) — TTL for `fetching` jobs; after the TTL, another fetch worker can reclaim the job.
- `VORYN_FETCH_RETRY_MAX_ATTEMPTS` (`optional`, default `10`) — maximum fetch attempts.
- `VORYN_FETCH_RETRY_BASE_DELAY_MS` (`optional`, default `1_000`) — base retry delay.
- `VORYN_FETCH_RETRY_MAX_DELAY_MS` (`optional`, default `10_000`) — maximum retry delay.

For `sequencer`:

- `VORYN_SEQUENCER_RPC_URL` (`optional`) — RPC URL for checking the current branch during chain reorganization.
- `VORYN_SEQUENCER_FALLBACK_RPC_URL` (`required`) — fallback RPC URL used on an error.
- `VORYN_SEQUENCER_RPC_REQUEST_TIMEOUT_MS` (`optional`, default `5_000`) — timeout for one HTTP RPC request.
- `VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS` (`optional`, default `100`) — delay between sequencer ticks.
- `VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK` (`optional`, default `10`) — maximum number of blocks the sequencer processes in one `tick`.

For `retention`:

- `VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS` (`optional`, default `60_000`) — delay between ticks in milliseconds.
- `VORYN_RETENTION_DEPTH_BLOCKS` (`optional`, default `65_000`) — storage depth in committed blocks.

## Operational Dev Scripts

Apply the SQL schema:

```bash
npm run db:apply-sql -- src/sql/postgres-schema.sql
```

Get a pipeline metrics snapshot:

```bash
npm exec -- tsx --tsconfig dev/tsconfig.json dev/metrics.ts
```

For `metrics`:

- `VORYN_METRICS_RPC_URL` (`required`) — RPC URL for reading the current latest block.
- `VORYN_METRICS_FALLBACK_RPC_URL` (`required`) — fallback RPC URL used on an error.
- `VORYN_METRICS_RPC_REQUEST_TIMEOUT_MS` (`optional`, default `5_000`) — timeout for one HTTP RPC request.

Return failed block jobs to processing:

```bash
npm exec -- tsx --tsconfig dev/tsconfig.json dev/block-job-recovery.ts
```

For `block-job-recovery`:

- `VORYN_RECOVERY_BLOCK` (`optional`) — one failed block to retry.
- `VORYN_RECOVERY_FROM_BLOCK` (`optional`) — beginning of a failed block range.
- `VORYN_RECOVERY_TO_BLOCK` (`optional`) — end of a failed block range.
- `VORYN_RECOVERY_ALL_FAILED=true` (`optional`) — retry all failed blocks.

Set one mode: `VORYN_RECOVERY_ALL_FAILED=true`, `VORYN_RECOVERY_BLOCK`, or both range variables:
`VORYN_RECOVERY_FROM_BLOCK` and `VORYN_RECOVERY_TO_BLOCK`.

Example:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" \
VORYN_CHAIN_ID=1 \
VORYN_HEAD_RPC_URL="https://rpc.example.org" \
npm exec -- tsx --tsconfig dev/tsconfig.json dev/head.ts
```

## Releases

Releases are automated with `semantic-release` from Conventional Commits on `main`.

After CI checks pass on a push to `main`, the release job:

- reads commits since the previous `vX.Y.Z` tag;
- chooses the next semantic version;
- updates `CHANGELOG.md`, `package.json`, and `package-lock.json`;
- creates a release commit and tag;
- creates a GitHub Release;
- publishes the package to npm.

Required npm Trusted Publishing configuration:

- package: `@drillcoder/voryn`;
- repository owner: `drillcoder`;
- repository name: `voryn`;
- workflow filename: `ci.yml`;
- environment: empty unless the release job starts using a GitHub environment.

To inspect the next release locally without publishing:

```bash
npm run release:dry-run
```
