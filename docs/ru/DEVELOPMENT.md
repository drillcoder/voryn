# Разработка

Команды для разработки собраны в `dev/Makefile`.
Для удобства в корне есть прокси-`Makefile`, поэтому можно запускать: `make lint`, `make test`, `make init`.

Основные команды:

- `make install` — установить зависимости в `tools`-контейнере.
- `make build` — собрать пакет.
- `make build-test` — проверить компиляцию тестов.
- `make lint` — запустить ESLint.
- `make test` — запустить unit-тесты.
- `make test-all` — запустить весь Jest-набор.
- `make test-coverage` — запустить тесты с coverage.

## Docker (dev)

Для docker-compose переменная `VORYN_CHAIN_ID` обязательна (`is required`),
а RPC-переменные обязательны по воркеру:
`VORYN_HEAD_RPC_URL`, `VORYN_FETCH_RPC_URL`.
и берутся из окружения.
Удобно начать с `dev/.env.example`:

```bash
cp dev/.env.example dev/.env
```

Запуск воркеров:

```bash
docker compose --env-file dev/.env -f dev/docker-compose.yml up -d postgres head fetch sequencer retention
```

Логи:

```bash
docker compose --env-file dev/.env -f dev/docker-compose.yml logs -f head fetch sequencer retention
```

## Запуск воркеров обработки блоков

Для запуска используйте dev-скрипты:

- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/head.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/fetch.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/sequencer.ts`
- `npm exec -- tsx --tsconfig dev/tsconfig.json dev/retention.ts`

Основные переменные окружения:

- `DATABASE_URL` (`required`) — строка подключения к PostgreSQL.
- `VORYN_CHAIN_ID` (`required`) — числовой id сети для обработки блоков.
- `VORYN_LOG_LEVEL` (`optional`, `debug` | `info` | `warn` | `error`, по умолчанию `info`) — минимальный уровень логов.

Дополнительно для `head`:

- `VORYN_HEAD_RPC_URL` (`required`) — RPC URL для чтения текущего хеда сети.
- `VORYN_HEAD_FALLBACK_RPC_URL` (`required`) — резервный RPC URL на случай ошибки.
- `VORYN_HEAD_RPC_REQUEST_TIMEOUT_MS` (`optional`, по умолчанию `5_000`) — таймаут одного HTTP RPC-запроса.
- `VORYN_HEAD_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `1_000`) — задержка между тиками в миллисекундах.
- `VORYN_HEAD_CONFIRMATIONS` (`optional`, по умолчанию `0`) — число подтверждений перед постановкой блока в очередь.
- `VORYN_HEAD_DEPTH_BLOCKS` (`optional`, по умолчанию `65_000`, должен быть `> 0`) — допустимое отставание от `safe head` в блоках. Если `last_committed_block` уходит глубже, `head` делает rebase к границе доступной истории RPC.

Дополнительно для `fetch`:

- `VORYN_FETCH_RPC_URL` (`required`) — RPC URL для загрузки данных блоков.
- `VORYN_FETCH_FALLBACK_RPC_URL` (`required`) — резервный RPC URL на случай ошибки.
- `VORYN_FETCH_RPC_REQUEST_TIMEOUT_MS` (`optional`, по умолчанию `30_000`) — таймаут одного HTTP RPC-запроса.
- `VORYN_FETCH_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `100`) — задержка между тиками в миллисекундах.
- `VORYN_FETCH_BATCH_SIZE` (`optional`, по умолчанию `10`) — максимум задач за один `tick`.
- `VORYN_FETCH_CONCURRENCY` (`optional`, по умолчанию `1`) — максимум задач, которые `fetch` обрабатывает параллельно.
- `VORYN_FETCH_CLAIM_TTL_MS` (`optional`, по умолчанию `125_000`) — TTL для `fetching`-задач; после TTL задача может быть пере-захвачена другим fetch-воркером.
- `VORYN_FETCH_RETRY_MAX_ATTEMPTS` (`optional`, по умолчанию `10`) — максимум попыток загрузки.
- `VORYN_FETCH_RETRY_BASE_DELAY_MS` (`optional`, по умолчанию `1_000`) — базовая задержка между ретраями.
- `VORYN_FETCH_RETRY_MAX_DELAY_MS` (`optional`, по умолчанию `10_000`) — максимальная задержка между ретраями.

Дополнительно для `sequencer`:

- `VORYN_SEQUENCER_RPC_URL` (`optional`) — RPC URL для проверки актуальной ветки при реорганизации цепи.
- `VORYN_SEQUENCER_FALLBACK_RPC_URL` (`required`) — резервный RPC URL на случай ошибки.
- `VORYN_SEQUENCER_RPC_REQUEST_TIMEOUT_MS` (`optional`, по умолчанию `5_000`) — таймаут одного HTTP RPC-запроса.
- `VORYN_SEQUENCER_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `100`) — задержка между тиками sequencer.
- `VORYN_SEQUENCER_MAX_BLOCKS_PER_TICK` (`optional`, по умолчанию `10`) — максимальное число блоков, которое sequencer обрабатывает за один `tick`.

Дополнительно для `retention`:

- `VORYN_RETENTION_DELAY_BETWEEN_TICKS_MS` (`optional`, по умолчанию `60_000`) — задержка между тиками в миллисекундах.
- `VORYN_RETENTION_DEPTH_BLOCKS` (`optional`, по умолчанию `65_000`) — глубина хранения в committed-блоках.

## Операционные dev-скрипты

Применить SQL-схему:

```bash
npm run db:apply-sql -- src/sql/postgres-schema.sql
```

Получить snapshot метрик пайплайна:

```bash
npm exec -- tsx --tsconfig dev/tsconfig.json dev/metrics.ts
```

Дополнительно для `metrics`:

- `VORYN_METRICS_RPC_URL` (`required`) — RPC URL для чтения текущего latest block.
- `VORYN_METRICS_FALLBACK_RPC_URL` (`required`) — резервный RPC URL на случай ошибки.
- `VORYN_METRICS_RPC_REQUEST_TIMEOUT_MS` (`optional`, по умолчанию `5_000`) — таймаут одного HTTP RPC-запроса.

Вернуть failed block jobs в обработку:

```bash
npm exec -- tsx --tsconfig dev/tsconfig.json dev/block-job-recovery.ts
```

Дополнительно для `block-job-recovery`:

- `VORYN_RECOVERY_BLOCK` (`optional`) — один failed-блок для повторной обработки.
- `VORYN_RECOVERY_FROM_BLOCK` (`optional`) — начало диапазона failed-блоков.
- `VORYN_RECOVERY_TO_BLOCK` (`optional`) — конец диапазона failed-блоков.
- `VORYN_RECOVERY_ALL_FAILED=true` (`optional`) — повторно отправить все failed-блоки.

Нужно задать один режим: `VORYN_RECOVERY_ALL_FAILED=true`, `VORYN_RECOVERY_BLOCK` или обе переменные диапазона:
`VORYN_RECOVERY_FROM_BLOCK` и `VORYN_RECOVERY_TO_BLOCK`.

Пример:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" \
VORYN_CHAIN_ID=1 \
VORYN_HEAD_RPC_URL="https://rpc.example.org" \
npm exec -- tsx --tsconfig dev/tsconfig.json dev/head.ts
```

## Релизы

Релизы автоматизированы через `semantic-release` по Conventional Commits в `main`.

После успешного CI на push в `main` release job:

- читает коммиты после предыдущего тега `vX.Y.Z`;
- выбирает следующую semantic version;
- обновляет `CHANGELOG.md`, `package.json` и `package-lock.json`;
- создает release commit и tag;
- создает GitHub Release;
- публикует пакет в npm.

Обязательная настройка npm Trusted Publishing:

- package: `@drillcoder/voryn`;
- repository owner: `drillcoder`;
- repository name: `voryn`;
- workflow filename: `ci.yml`;
- environment: пусто, если release job не использует GitHub environment.

Локально посмотреть следующий релиз без публикации:

```bash
npm run release:dry-run
```
