# Разработка

Команды для разработки собраны в `Makefile`

## Docker (dev)

Для docker-compose переменная `VORYN_CHAIN_ID` обязательна (`is required`),
а RPC-переменные обязательны по воркеру:
`VORYN_HEAD_RPC_URL`, `VORYN_FETCH_RPC_URL`.
и берутся из окружения.
Удобно начать с `.env.example`:

```bash
cp .env.example .env
```

Запуск воркеров:

```bash
docker compose up -d postgres head fetch sequencer retention
```

Логи:

```bash
docker compose logs -f head fetch sequencer retention
```

## CLI для разработки: запуск ingestion-воркеров

Доступны команды:

- `voryn head`
- `voryn fetch`
- `voryn sequencer`
- `voryn retention`

Основные переменные окружения:

- `DATABASE_URL` (`required`) — строка подключения к PostgreSQL.
- `VORYN_CHAIN_ID` (`required`) — числовой id сети для ingestion.
- `VORYN_LOG_LEVEL` (`optional`, `debug` | `info` | `warn` | `error`, по умолчанию `info`) — минимальный уровень логов.

Дополнительно для `head`:

- `VORYN_HEAD_RPC_URL` (`required`) — RPC URL для чтения текущего хеда сети.
- `VORYN_HEAD_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `1_000`) — задержка между тиками в миллисекундах.
- `VORYN_HEAD_CONFIRMATIONS` (`optional`, по умолчанию `0`) — число подтверждений перед постановкой блока в очередь.
- `VORYN_HEAD_DEPTH_BLOCKS` (`optional`, по умолчанию `65_000`, должен быть `> 0`) — допустимое отставание от `safe head` в блоках. Если `last_committed_block` уходит глубже, `head` делает rebase к границе доступной истории RPC.

Дополнительно для `fetch`:

- `VORYN_FETCH_RPC_URL` (`required`) — RPC URL для загрузки данных блоков.
- `VORYN_FETCH_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `100`) — задержка между тиками в миллисекундах.
- `VORYN_FETCH_WORKER_ID` (`optional`, по умолчанию {hostname}-{pid}) — уникальный id fetch-воркера.
- `VORYN_FETCH_BATCH_SIZE` (`optional`, по умолчанию `10`) — максимум задач за один `tick`.
- `VORYN_FETCH_CLAIM_TTL_MS` (`optional`, по умолчанию `125_000`) — TTL для `fetching`-задач; после TTL задача может быть пере-захвачена другим fetch-воркером.
- `VORYN_FETCH_RETRY_MAX_ATTEMPTS` (`optional`, по умолчанию `10`) — максимум попыток загрузки.
- `VORYN_FETCH_RETRY_BASE_DELAY_MS` (`optional`, по умолчанию `1_000`) — базовая задержка между ретраями.
- `VORYN_FETCH_RETRY_MAX_DELAY_MS` (`optional`, по умолчанию `10_000`) — максимальная задержка между ретраями.

Дополнительно для `sequencer`:

- `VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `100`) — задержка между тиками sequencer.
- `VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK` (`optional`, по умолчанию `10`) — максимальное число блоков, которое sequencer обрабатывает за один `tick`.

Дополнительно для `retention`:

- `VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `60_000`) — задержка между тиками в миллисекундах.
- `VORYN_RETENTION_DEPTH_BLOCKS` (`optional`, по умолчанию `65_000`) — глубина хранения в committed-блоках.

Пример:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" \
VORYN_CHAIN_ID=1 \
VORYN_HEAD_RPC_URL="https://rpc.example.org" \
voryn head
```
