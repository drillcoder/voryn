# Voryn

TypeScript npm-библиотека для мониторинга EVM-подобных сетей.

## Документация

- Архитектура: [ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- Схема БД: [DB_SCHEMA.md](/docs/DB_SCHEMA.md)

## CLI: инициализация БД

Команда применяет SQL-схему PostgreSQL из `postgres-schema.sql`.

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" voryn init
```

## CLI: запуск ingestion-воркеров

Доступны команды:

- `voryn head`
- `voryn fetch`
- `voryn sequencer`
- `voryn retention`

Основные переменные окружения:

- `DATABASE_URL` (`required`)
- `VORYN_CHAIN_ID` (`required`)
- `VORYN_POLL_INTERVAL_MS` (`optional`, по умолчанию `1000`)
- `VORYN_LOG_LEVEL` (`optional`, `debug` | `info` | `warn` | `error`, по умолчанию `info`)

Дополнительно для `head`:

- `VORYN_RPC_URL` (`required`)
- `VORYN_CONFIRMATIONS` (`optional`, по умолчанию `0`)

Дополнительно для `fetch`:

- `VORYN_RPC_URL` (`required`)
- `VORYN_FETCH_WORKER_ID` (`optional`, по умолчанию {hostname}-{pid})
- `VORYN_FETCH_BATCH_SIZE` (`optional`, по умолчанию `5`)
- `VORYN_FETCH_RETRY_MAX_ATTEMPTS` (`optional`, по умолчанию `10`)
- `VORYN_FETCH_RETRY_BASE_DELAY_MS` (`optional`, по умолчанию `1_000`)
- `VORYN_FETCH_RETRY_MAX_DELAY_MS` (`optional`, по умолчанию `10_000`)

Дополнительно для `sequencer`:

- `VORYN_RPC_URL` (`required`)

Дополнительно для `retention`:

- `VORYN_RETENTION_RAW_BLOCKS_HOURS` (`optional`, по умолчанию `24`)
- `VORYN_RETENTION_CANONICAL_HOURS` (`optional`, по умолчанию `24`)

Пример:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" \
VORYN_CHAIN_ID=1 \
VORYN_RPC_URL="https://rpc.example.org" \
voryn head
```

## Адаптер ethers v6

В пакете есть готовый `EthersBlockSource`, который реализует интерфейс `BlockSource`
и подходит для `HeadWorker` / `FetchWorker`.

Пример:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "voryn";

const provider = new JsonRpcProvider(process.env.MAINNET_RPC_URL);

const source = new EthersBlockSource({
    provider,
    validateProviderChainId: true,
});
```

Опции:

- `provider` (обязательно): `ethers`-провайдер для нужной сети.
- `validateProviderChainId` (опционально): проверяет, что `provider.getNetwork().chainId`
  совпадает с запрошенным `chainId` (проверка кэшируется после первого успешного вызова).

`EthersBlockSource` валидирует хеши, адреса и `data`-поля, а также индексы и соответствие
номера блока. При некорректном ответе RPC бросает ошибку, чтобы воркеры могли повторить задачу.

## Логгер

Библиотека использует интерфейс `Logger` (`debug`, `info`, `warn`, `error`).

- `noopLogger` ничего не выводит и подходит как безопасный дефолт.
- `createConsoleLogger` дает простую реализацию для локальной разработки и CLI.

Пример:

```ts
import { createConsoleLogger } from "voryn";

const logger = createConsoleLogger({
    minLevel: "debug",
    colorize: true,
    timestamp: true,
});
```

Опции `createConsoleLogger`:

- `minLevel`: минимальный уровень (`debug` | `info` | `warn` | `error`).
- `colorize`: цветные уровни в консоли (`DEBUG`, `INFO`, `WARN`, `ERROR`).
- `timestamp`: добавляет ISO-время в начало строки.
- `stdout` / `stderr`: можно передать свои потоки вывода.

## Разработка

Команды для разработки собраны в `Makefile`

## Docker (dev)

Для docker-compose переменные `VORYN_CHAIN_ID` и `VORYN_RPC_URL` обязательны (`is required`)
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

Для одноразовых команд (install/build/lint/test/db-init) используется сервис `tools`
через `docker compose run --rm tools ...` (смотрите `Makefile`).
