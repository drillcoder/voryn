# Voryn

TypeScript npm-библиотека для мониторинга EVM-подобных сетей.

## Документация

- Архитектура: [ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- Схема БД: [DB_SCHEMA.md](/docs/DB_SCHEMA.md)

## Адаптер ethers v6

В пакете есть готовый `EthersBlockSource`, который реализует интерфейс `BlockSource`
и подходит для `HeadWorker` / `FetchWorker`.

Пример:

```ts
import { JsonRpcProvider } from "ethers";
import { EthersBlockSource } from "voryn";

const providers = new Map([
    [1, new JsonRpcProvider(process.env.MAINNET_RPC_URL)],
    [137, new JsonRpcProvider(process.env.POLYGON_RPC_URL)],
]);

const source = new EthersBlockSource({
    providers,
    validateProviderChainId: true,
});
```

Опции:

- `providers` (обязательно): `Map<chainId, provider>`.
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

```bash
npm install
npm run build
npm run lint
npm test
```

Дополнительные команды:

- `npm run lint:fix` — исправить часть ошибок линтера автоматически.
- `npm run test:coverage` — запустить тесты с отчетом покрытия.
- `npm run test:watch` — запускать тесты в watch-режиме.
