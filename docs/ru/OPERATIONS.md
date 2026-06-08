# Эксплуатация

Этот runbook описывает, как запускать и сопровождать Voryn в живой системе.
Он про процессы, порядок запуска, масштабирование, мониторинг, recovery и типовые инциденты.

Подробности архитектуры: [ARCHITECTURE.md](./ARCHITECTURE.md).
Поля таблиц: [DB_SCHEMA.md](./DB_SCHEMA.md).

## Компоненты

Запускайте воркеры как отдельные процессы или контейнеры. Процессы координируются через PostgreSQL.

- `HeadWorker`: один экземпляр на `chainId`.
- `FetchWorker`: один или несколько экземпляров на `chainId`.
- `SequencerWorker`: один экземпляр на `chainId`.
- `RetentionWorker`: один экземпляр на `chainId`.
- Reaction workers: один экземпляр на пару `workerName + chainId`.

`HeadWorker`, `SequencerWorker`, `RetentionWorker` и reaction workers работают как singleton-воркеры.
Они используют `LeaderLock`, поэтому дублирующие процессы не должны одновременно выполнять одну и ту же singleton-нагрузку.
`FetchWorker` не использует singleton-lock и может масштабироваться горизонтально.

## Порядок запуска

Для новой среды используйте такой порядок:

1. Запустить PostgreSQL.
2. Применить SQL-схему из `src/sql/postgres-schema.sql`.
3. Запустить `HeadWorker`.
4. Запустить один или несколько процессов `FetchWorker`.
5. Запустить `SequencerWorker`.
6. Запустить `RetentionWorker`.
7. Запустить reaction workers.

## Options воркеров

Общие options:

- `chainId`: numeric chain id для воркера.
- `delayBetweenTicksMs`: пауза между ticks воркера.
- `dbUrl`: строка подключения к PostgreSQL, если зависимости не переданы через `overrides`.
- `logLevel` или `logger`: встроенный уровень логирования или свой logger.
- `rpcUrl` или `source`: block source для `HeadWorker`, `FetchWorker` и `SequencerWorker`.

`HeadWorker`:

- `confirmations`: сколько последних блоков не ставить в очередь.
- `depthBlocks`: максимальное окно блоков, которое `head` держит доступным для постановки в очередь. Если committed progress отстает сильнее этого окна, `head` делает rebase к доступной границе.

`FetchWorker`:

- `fetchBatchSize`: максимум jobs, которые worker забирает за один tick.
- `fetchConcurrency`: максимум block fetches, которые один worker process выполняет параллельно.
- `fetchClaimTtlMs`: время, после которого зависший job в статусе `fetching` можно забрать повторно.
- `retryMaxAttempts`: максимальное число fetch attempts до того, как job остается в `failed`.
- `retryBaseDelayMs`: начальная задержка retry после ошибки fetch.
- `retryMaxDelayMs`: максимальная задержка retry после повторных ошибок fetch.

`SequencerWorker`:

- `maxBlocksPerTick`: максимум блоков, которые можно committed за один tick.

`RetentionWorker`:

- `retentionDepthBlocks`: число committed-блоков, которые хранятся позади текущей committed-позиции.

`EventReactionWorker` и `TransactionReactionWorker`:

- `workerName`: стабильное имя reaction worker. Вместе с `chainId` и типом stream оно определяет cursor и lock.
- `batchSize`: максимум stream items, которые worker читает за один tick.
- `skipFlushInterval`: как часто skipped items сбрасывают cursor progress.
- `handler`: application callback для одного event или transaction.

## Масштабирование и настройки

Сначала масштабируйте `fetch`. Очередь загрузки хранится в `block_jobs`, и несколько процессов `FetchWorker` могут
забирать jobs из очереди одной сети.

Настройки `FetchWorker`:

- Увеличивайте число процессов `FetchWorker`, когда `fetch` lag растет, а RPC и PostgreSQL еще имеют запас.
- Увеличивайте `fetchConcurrency`, когда один процесс `FetchWorker` недогружен и RPC provider разрешает больше параллельных запросов.
- Увеличивайте `fetchBatchSize`, когда один tick `FetchWorker` слишком маленький и воркеры слишком часто опрашивают очередь.
- Держите `fetchBatchSize >= fetchConcurrency`, чтобы один tick `FetchWorker` мог заполнить все параллельные fetch-слоты.

Настройки `SequencerWorker`:

- Увеличивайте `maxBlocksPerTick`, когда fetched jobs готовы, но `sequencer` lag продолжает расти.

Начинайте с консервативных значений. Слишком высокий `fetchConcurrency` или слишком много fetch-процессов могут
перегрузить RPC provider, увеличить число failed jobs и ухудшить retries.

## Reaction workers

Reaction workers запускают прикладную логику по committed-данным:

- `EventReactionWorker` читает из `events`.
- `TransactionReactionWorker` читает из `transactions`.
- У каждого worker свой cursor в `worker_cursors`.
- Идентификатор cursor: `workerName + chainId + streamType`.

При первом запуске reaction worker создает cursor на текущем committed-блоке. Он не обрабатывает старые committed-данные
до этой точки. Держите `workerName` стабильным между рестартами, если worker должен продолжать с того же cursor.

Каждый tick читает до `batchSize` items после сохраненного cursor и не дальше текущего committed-блока. Handler
возвращает:

- `"processed"`: cursor двигается после этого item.
- `"skipped"`: item намеренно пропущен; cursor progress сбрасывается по `skipFlushInterval` и в конце tick.

Если handler выбрасывает ошибку, worker останавливает текущий tick и оставляет cursor на последней сброшенной позиции.
Тот же item может прийти снова после restart или retry. Handlers должны быть идемпотентными, особенно если они пишут во
внешние системы.

Важные эксплуатационные моменты:

- Reaction workers не блокируют `head`, `fetch` или `sequencer`.
- Медленный reaction worker увеличивает reaction lag, но загрузка блоков продолжается.
- Retention не ждет reaction cursors, поэтому reaction lag должен оставаться меньше `retentionDepthBlocks`.
- Reorg может привести к повторной доставке той же transaction или event, если она снова попадет в committed-цепочку.

## Retention

`retentionDepthBlocks` — это число committed-блоков, которые нужно хранить позади текущей committed-позиции.
`RetentionWorker` удаляет старые строки из `block_jobs`, `blocks`, `transactions` и `events`, когда данные выходят за
retention-окно.

Выбирайте глубину с учетом:

- ожидаемого reaction lag;
- времени реакции на инциденты;
- ожидаемой глубины reorg для сети;
- лимитов истории у RPC provider;
- времени, за которое операторам могут понадобиться старые данные для отладки.

Слишком маленькое значение опасно. Если reaction worker сильно отстанет, старые строки могут стать недоступны до того,
как handler их обработает. Следите за reaction lag и держите `retentionDepthBlocks` заметно выше максимального
ожидаемого reaction lag.

Retention не ждет reaction cursors перед удалением старых строк. Считайте reaction lag операционным лимитом, который
должен оставаться внутри retention-окна.

Если reaction lag приближается к retention depth, сначала чините lag: при возможности остановите retention,
масштабируйте или почините reaction worker, и только потом возвращайте обычную очистку.

## Recovery

Используйте `BlockJobRecovery`, когда block jobs находятся в статусе `failed`, а причина уже устранена.
Типовые случаи: временный сбой RPC, плохой ответ RPC или ошибка в настройке provider.

Повторно отправить один failed block:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryFailedBlock(123);
await recovery.close();
```

Повторно отправить диапазон failed blocks:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryFailedRange(124, 130);
await recovery.close();
```

Повторно отправить все failed blocks:

```ts
const recovery = await BlockJobRecovery.create({
    dbUrl: "postgres://user:pass@localhost:5432/voryn",
    logLevel: "info",
    chainId: 1,
});

await recovery.retryAllFailedBlocks();
await recovery.close();
```

Не запускайте ручной recovery, пока причина сбоя активна. Если RPC все еще возвращает ошибки, recovery просто вернет
те же jobs обратно в failed. Также не делайте ручной recovery, когда sequencer обрабатывает reorg: дайте sequencer
закончить rollback, а `head` — заново поставить правильный диапазон в очередь.

## Метрики

`PipelineMetrics` возвращает snapshot такой структуры:

```json
{
  "observedAt": "2026-05-30T10:00:00.000Z",
  "chains": [
    {
      "chainId": 1,
      "observedAt": "2026-05-30T10:00:00.000Z",
      "latestBlock": 1999950,
      "stages": {
        "head": { "block": 1999940, "lagBlocks": 10 },
        "fetch": { "block": 1999900, "lagBlocks": 50 },
        "sequencer": { "block": 1999880, "lagBlocks": 70 }
      },
      "maxLag": { "blocks": 70, "seconds": 840 },
      "freshness": {
        "secondsSincePipelineUpdate": 3,
        "secondsSinceFetch": 2
      },
      "blockStatusCounts": {
        "pending": 40,
        "fetching": 4,
        "fetched": 16,
        "committed": 1999800,
        "failed": 0
      },
      "failedBlocks": [
        {
          "block": 1999701,
          "attempts": 3,
          "error": "RPC timeout",
          "nextRetryAt": "2026-05-30T10:00:30.000Z",
          "updatedAt": "2026-05-30T09:59:50.000Z"
        }
      ],
      "reactions": [
        {
          "workerName": "contract-events",
          "streamType": "event",
          "block": 1999800,
          "lagBlocks": 80,
          "secondsSinceProgress": 5
        }
      ]
    }
  ]
}
```

Поля:

- Верхнеуровневый `observedAt`: время сбора всего snapshot.
- `chains[]`: отдельный объект метрик для каждого настроенного `chainId`.
- `latestBlock`: последний блок по данным настроенного block source.
- `stages.head`: текущий блок стадии head и lag до `latestBlock`.
- `stages.fetch`: текущий блок стадии fetch и lag до `latestBlock`.
- `stages.sequencer`: текущий блок стадии sequencer и lag до `latestBlock`.
- `maxLag`: максимальный lag в блоках и секундах.
- `freshness`: сколько секунд прошло с последнего обновления пайплайна и последнего fetch-прогресса.
- `blockStatusCounts`: счетчики jobs в статусах `pending`, `fetching`, `fetched`, `committed` и `failed`.
- `failedBlocks`: последние failed-блоки с attempts, последней ошибкой, временем следующего retry и временем обновления.
- `reactions`: курсоры reaction workers, lag от committed cursor цепи и секунды с последнего движения курсора.

Prometheus-вывод включает такие gauges:

- `voryn_pipeline_latest_block`
- `voryn_pipeline_stage_block`
- `voryn_pipeline_stage_lag_blocks`
- `voryn_pipeline_max_lag_blocks`
- `voryn_pipeline_max_lag_seconds`
- `voryn_pipeline_freshness_seconds`
- `voryn_pipeline_block_jobs`
- `voryn_pipeline_failed_block_attempts`
- `voryn_pipeline_failed_block_next_retry_timestamp_seconds`
- `voryn_pipeline_failed_block_updated_timestamp_seconds`
- `voryn_pipeline_reaction_block`
- `voryn_pipeline_reaction_lag_blocks`
- `voryn_pipeline_reaction_seconds_since_progress`

Здоровое состояние обычно выглядит так:

- `head` lag небольшой для сети и настроенного числа confirmations.
- `fetch` lag не растет постоянно и уменьшается, когда fetch-воркерам хватает мощности.
- `sequencer` lag не растет бесконечно.
- Jobs в статусе `failed` не накапливаются.
- Reaction lag остается заметно ниже `retentionDepthBlocks`.
- Время с последнего fetch или reaction progress не растет постоянно, пока воркеры запущены.

Настройте alerts на слишком большой lag стадий, появление failed jobs, отсутствие обновления progress timestamps и приближение reaction lag к `retentionDepthBlocks`.

## Типовые проблемы

### RPC недоступен

Симптомы:
- `head` не может прочитать latest block;
- `fetch` jobs переходят в `failed`;
- freshness растет;
- failed blocks показывают RPC-ошибки.

Что делать:
- проверить статус provider, credentials, rate limits и сетевой доступ;
- снизить fetch concurrency, если RPC provider ограничивает запросы;
- переключиться на рабочий provider, если он есть;
- использовать `BlockJobRecovery` только после устранения RPC-проблемы.

### Много failed jobs

Симптомы:
- `blockStatusCounts.failed` растет;
- `failedBlocks` показывает повторяющиеся attempts или похожие ошибки.

Что делать:
- сначала посмотреть ошибки failed blocks;
- понять, это provider errors, ошибки схемы/БД или проблема обработки блока;
- исправить причину до recovery;
- сначала повторить один блок, затем диапазон, если один блок прошел успешно.

### Fetch отстает

Симптомы:
- `stages.fetch.lagBlocks` растет;
- много jobs в статусе `pending`;
- RPC и PostgreSQL не перегружены.

Что делать:
- добавить процессы `FetchWorker`;
- осторожно увеличить `fetchConcurrency`;
- увеличить `fetchBatchSize`, если воркеры слишком часто опрашивают очередь;
- проверить RPC rate limits перед дальнейшим масштабированием.

### Sequencer не двигается

Симптомы:
- jobs в статусе `fetched` есть, но `stages.sequencer.block` не растет;
- `sequencer` lag увеличивается.

Что делать:
- проверить, не отсутствует ли следующий обязательный блок и не находится ли он в failed;
- посмотреть logs на `parent_hash` mismatch или rollback;
- убедиться, что `maxBlocksPerTick` не слишком мал для backlog;
- не пропускать блоки вручную, потому что committed-последовательность должна оставаться непрерывной.

### Reaction handler падает

Симптомы:
- обработка блоков продолжается, но lag одного reaction worker растет;
- `secondsSinceProgress` растет;
- logs воркера показывают ошибки handler.

Что делать:
- исправить handler или его внешнюю зависимость;
- держать side effects идемпотентными, потому что один и тот же item может быть обработан повторно;
- убедиться, что retention depth достаточно большой для текущего lag;
- перезапустить воркер после исправления.

### Retention удаляет старые данные

Симптомы:
- старые blocks, transactions, events или jobs больше не существуют;
- отставший reaction не может найти старые данные.

Что делать:
- сравнить reaction lag с `retentionDepthBlocks`;
- помнить, что retention не сбрасывает reaction cursor; если старые строки потока уже удалены, воркер продолжит с первой доступной строки после сохраненного cursor, а удаленный промежуток не будет обработан повторно;
- увеличить retention depth для будущих данных;
- считать удаленный промежуток потерянным для этого reaction worker в обычном режиме работы;
- если нужен точный replay, планировать отдельную процедуру restore/rebuild и сначала остановить или изменить retention;
- не ставить retention depth ниже операционных потребностей recovery.

### Lock уже занят

Симптомы:
- singleton worker стартует, но не выполняет работу;
- logs показывают, что `LeaderLock` не может быть получен.

Что делать:
- проверить, не запущен ли другой процесс для той же сети и роли;
- держать только одну активную singleton-нагрузку на сеть;
- если процесс умер, дождаться нормального освобождения PostgreSQL advisory lock через закрытие connection;
- проверить зависшие инфраструктурные процессы перед повторными рестартами.

## Reorg behavior

`SequencerWorker` проверяет, что следующий fetched-блок связан с текущей committed-позицией.
Если `parent_hash` следующего блока не совпадает с `chain_cursor.last_committed_hash`, sequencer считает это reorg.

Во время обработки reorg он:

- ищет общего предка через `BlockSource`;
- возвращает `chain_cursor` к этому предку;
- удаляет замененные данные после предка из `block_jobs`, `blocks`, `transactions` и `events`;
- дает `head` заново поставить правильные блоки в очередь.

Reaction workers читают только данные внутри committed-позиции. Поэтому handlers не работают с fetched, но еще
uncommitted блоками, и меньше зависят от смены ветки.

Транзакции и события из откатившихся блоков могут повторно прийти в reaction workers, если после reorg они снова
попали в committed-цепочку. Reaction handlers должны быть идемпотентными и безопасными для повторной обработки одной
и той же transaction или event.

## Production checklist

- SQL-схема из `src/sql/postgres-schema.sql` применена.
- `validatePostgresSchema` проходит на production database.
- Для каждой сети запущен ожидаемый набор воркеров.
- `PipelineMetrics` доступен мониторингу, например через endpoint приложения или exporter.
- Alerts покрывают stage lag, failed jobs, progress timestamps, которые перестали обновляться, и приближение reaction lag к `retentionDepthBlocks`.
- RPC provider имеет достаточные rate limits для настроенного fetch scale.
- `fetchConcurrency`, `fetchBatchSize` и `maxBlocksPerTick` выбраны для каждой сети с учетом лимитов RPC и PostgreSQL.
- `retentionDepthBlocks` больше ожидаемого reaction lag и времени реакции на инциденты.
- Reaction handlers идемпотентны.
- Operator runbooks описывают retry одного failed block и диапазона failed blocks.
