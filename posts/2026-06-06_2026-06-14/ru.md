Период: 6 июня 2026 - 14 июня 2026.

На этом этапе я доводил Voryn до состояния, где библиотеку можно не только запустить, но и безопасно сопровождать после сбоев.

Фокус был вокруг трех вещей: recovery для failed jobs, контролируемый reorg rollback и автоматизация релизов.

Что было сделано:

- добавил retry all failed block recovery;
- сделал reorg rollback через ограниченные диапазоны;
- убрал старый delete-after API из repository-контрактов;
- упростил Prometheus-метрики по failed blocks;
- уточнил описание Voryn как библиотеки;
- добавил semantic-release и npm Trusted Publishing;
- упростил public hex-типы;
- выпустил версии 0.4.5 и 0.4.6.

Самое практичное изменение периода - recovery для всех failed blocks. До этого можно было вернуть в обработку один блок или диапазон. Но после RPC-инцидента часто нужно просто вернуть все failed jobs в очередь.

Для этого появился retryAllFailedBlocks. Runbook по-прежнему говорит, что recovery нельзя запускать, пока причина сбоя активна. Но когда причина исправлена, оператору не нужно вручную искать диапазоны.

Вторая часть - reorg rollback. Раньше rollback удалял данные “после блока”. Я заменил это на ограниченный диапазон: от блока после общего предка до текущего lastEnqueuedBlock. Старый deleteAfterBlockNumber API больше не нужен.

Это лучше совпадает с тем, как pipeline думает о данных. Reorg не означает “удали все после N вообще”. Он означает “откати известный хвост и верни cursor к общему предку”.

Отдельно почистил Prometheus-вывод. Детали конкретных failed blocks остались в JSON snapshot, а Prometheus показывает failed jobs через общий счетчик block job statuses. Prometheus - для gauges и alerts, snapshot - для подробностей.

Еще одно изменение - формулировка проекта. В README и package metadata Voryn стал называться TypeScript library for reliable EVM indexing with PostgreSQL. Это точнее, чем прежнее описание про ethers-based package: библиотека уже выросла в отдельный indexing pipeline.

В конце добавил semantic-release с Conventional Commits и npm Trusted Publishing. Release job запускается после успешного CI на main, считает следующую версию, обновляет changelog/package files, создает GitHub Release и публикует пакет в npm без ручного npm token.

Финальным штрихом стало упрощение public hex-типов. Вместо branded aliases остались template literal types вида 0x${string}. Для внешнего API это проще: типы отражают hex-формат, но не заставляют пользователя протаскивать внутренние brands через свой код.

Это последний пост в недельном формате: после 14 июня активная фаза разработки закончилась. Дальше логичнее писать отдельные посты по релизам.

Главная идея периода: после наблюдаемости следующим шагом стала управляемость - как восстановиться после failed jobs, аккуратно откатить reorg-хвост и выпускать версии без ручной рутины.
