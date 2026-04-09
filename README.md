# Voryn

TypeScript npm-библиотека для мониторинга EVM-подобных сетей.

## Документация

- Архитектура: [ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- Схема БД: [DB_SCHEMA.md](/docs/DB_SCHEMA.md)

## CLI: инициализация БД

Команда применяет SQL-схему PostgreSQL из `postgres-schema.sql`.

Параметры:

- `DATABASE_URL` (`required`) — строка подключения к PostgreSQL (например, `postgres://user:pass@host:5432/dbname`).

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" voryn init
```

## Адаптер ethers v6

В пакете есть готовый `EthersBlockSource`, который реализует интерфейс `BlockSource`
и подходит для `HeadWorker` / `FetchWorker`.

Пример:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "voryn";

const rpcUrl = "https://rpc.example.org";
const provider = new JsonRpcProvider(rpcUrl);

const source = new EthersBlockSource({ provider, validateProviderChainId: true });
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
- `ConsoleLogger` дает простую реализацию для локальной разработки и CLI.

Пример:

```ts
import { ConsoleLogger } from "voryn";

const logger = new ConsoleLogger({ minLevel: "debug", colorize: true, timestamp: true });
```

Опции `ConsoleLogger`:

- `minLevel`: минимальный уровень (`debug` | `info` | `warn` | `error`).
- `colorize`: цветные уровни в консоли (`DEBUG`, `INFO`, `WARN`, `ERROR`).
- `timestamp`: добавляет ISO-время в начало строки.
- `stdout` / `stderr`: можно передать свои потоки вывода.

## Примеры запуска воркеров из кода

Готовые примеры вынесены в отдельные файлы:

- `HeadWorker`: [examples/workers/head-worker.ts](/examples/head-worker.ts)
- `FetchWorker`: [examples/workers/fetch-worker.ts](/examples/fetch-worker.ts)
- `SequencerWorker`: [examples/workers/sequencer-worker.ts](/examples/sequencer-worker.ts)
- `RetentionWorker`: [examples/workers/retention-worker.ts](/examples/retention-worker.ts)
- `EventReactionWorker`: [examples/workers/event-reaction-worker.ts](/examples/event-reaction-worker.ts)
- `TransactionReactionWorker`: [examples/workers/transaction-reaction-worker.ts](/examples/transaction-reaction-worker.ts)

## Разработка

Подробно: [DEVELOPMENT.md](/docs/DEVELOPMENT.md)
