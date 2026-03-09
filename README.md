# Voryn

TypeScript npm-библиотека для мониторинга EVM-подобных сетей.

## Документация

- Архитектура: [ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- Схема БД: [DB_SCHEMA.md](/docs/DB_SCHEMA.md)

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
