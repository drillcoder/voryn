# Voryn

TypeScript npm-библиотека для мониторинга EVM-подобных сетей.

## Документация

- Архитектура: [ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- Схема БД: [DB_SCHEMA.md](/docs/DB_SCHEMA.md)

## CLI: инициализация БД

Команда применяет SQL-схему PostgreSQL из `postgres-schema.sql`.

```bash
voryn db init --url "postgres://user:pass@localhost:5432/voryn"
```

Можно использовать переменную окружения:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/voryn" voryn db init
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
