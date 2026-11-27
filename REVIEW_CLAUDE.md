Ревью сделал по v2-коду в src/ (v1 и design/examples глубоко не смотрел). Главное: в REST есть обход валидации, WS-стрим можно уронить одним фреймом, а клиент в нескольких случаях молча возвращает неверный результат.

Состояние гейтов: tsc --noEmit чистый, 154/154 теста зелёные, eslint даёт 162 ошибки (39 в v1, остальное в v2 — в основном `no-explicit-any`). Все находки ниже, кроме помеченных «по чтению кода», воспроизведены временным тестом; он удалён, дерево чистое. Пункты из «Долг» в [design/PROGRESS.md](design/PROGRESS.md#L50) не повторяю, кроме одного (п. 6).

## Высокие

1. REST: часть без схемы перетирает провалидированные поля. В [rest.ts:92-95](src/rest/rest.ts#L92-L95) срез без схемы целиком мержится во вход обработчика, причём query идёт после body. POST /pay?amount=-5&role=admin с телом {amount: 10} и схемой amount: z.number().positive() отдаёт обработчику {amount: "-5", role: "admin"}. Срезы без схемы не стоит мержить вовсе; для path — только имена из шаблона.

2. `fromWsStream`: фрейм `null` даёт unhandled rejection. binding.stream.handle(value) в [ws.ts:62](src/transport/ws.ts#L62) стоит вне try, а [events.ts:12-13](src/events/events.ts#L12-L13) читает req.method у null. В Node это по умолчанию завершает процесс, то есть сервер роняется одним сообщением. Там же вне try остались prev.return() и it.return() в ветке cancel.

3. WS-адаптеры не передают `ctx` и не отменяют стрим.
   - fromWs и fromWsStream зовут handle(value) без контекста ([ws.ts:29](src/transport/ws.ts#L29), [ws.ts:62](src/transport/ws.ts#L62)), и опции для него нет. DI-фабрики и auth-middleware получают {} (по чтению кода).
   - signal, который получает stream-обработчик, по WS никогда не абортится. Cancel и close вызывают только return(), а он встаёт в очередь за висящим next(). Генератор, ждущий события, не чистится ни после cancel, ни после закрытия сокета.

4. JSON-RPC клиент игнорирует HTTP-статус. unwrap в [client/index.ts:36-40](src/client/index.ts#L36-L40) смотрит только на body.error. Ответ 401 {"message":"unauthorized"} резолвится в undefined без ошибки. То же с parse error от собственного адаптера: [sveltekit.ts:46](src/transport/sveltekit.ts#L46) отдаёт 400 {detail}, а не конверт -32700.

5. REST-клиент неверно строит URL ([client/index.ts:107](src/client/index.ts#L107), [:86](src/client/index.ts#L86)).
   - Префикс endpoint теряется: endpoint: 'http://h/api/v1' даёт запрос на http://h/items/5.
   - Относительный endpoint (`'/api'`) бросает Invalid URL, хотя в JSON-RPC клиенте он работает.
   - Массив в query уходит как tag=a%2Cb, а сервер ждёт повторяющиеся ключи.

6. capnweb публикуется с открытым RCE. Долг известен, но ./capnweb есть в exports, а README называет Cap'n Web фичей. До фикса стоит убрать сабпат из exports или явно пометить его как небезопасный для недоверенных клиентов.

## Средние

7. REST-ошибки сводятся к 422 или 500 ([rest.ts:213-219](src/rest/rest.ts#L213-L219)). Issues валидации в ответ не попадают — приходит только {"detail":"Validation error"}. Обработчик не может вернуть объявленный в resp статус (404, 409): любое исключение даёт 500, RpcError.status не используется (вторая часть — по чтению кода).

8. Tool-путь валидирует вход дважды. Фреймворк валидирует tool.schema и передаёт распарсенное значение, затем core.call валидирует ещё раз ([tools/index.ts:23-24](src/tools/index.ts#L23-L24), [mcp/vercel/index.ts:105-106](src/mcp/vercel/index.ts#L105-L106)). Со схемой z.string().transform(s => s.length) второй проход падает с Validation error. Рядом две мелочи:
   - для void-обработчика toCallToolResult отдаёт блок {type:'text'} без text;
   - agentTools берёт schemas.jsonSchema без привязки this и с io 'output', тогда как flatToolSchema использует 'input' (по чтению кода).

9. Эвристики проводного формата расходятся с типами.
   - 1-кортеж: rpc.S.one('a') для z.tuple([z.string()]) шлёт голый скаляр и получает Validation error ([client/index.ts:169](src/client/index.ts#L169)).
   - z.array(z.unknown()): rpc.S.arr(['x']) доставляет обработчику [['x']], потому что обёрнутая форма проходит валидацию напрямую ([core/index.ts:250-257](src/core/index.ts#L250-L257)).
   - Метод без схемы: стандартный позиционный params: [5] приходит в echo(x) как [5] ([core/index.ts:282-286](src/core/index.ts#L282-L286)).

10. OpenAPI с рекурсивными схемами содержит висячие ссылки. [rest/docs.ts](src/rest/docs.ts) не вызывает hoistSchemaDefs, и в документе остаются #/$defs/__schema0 и "$ref":"#". Ссылку # не переписывает и сам hoistSchemaDefs ([generate/core.ts:72](src/generate/core.ts#L72)), так что OpenRPC, вероятно, затронут тоже (не проверял).

## Низкие

11. `__proto__` в query. ?__proto__=a&__proto__=b подменяет прототип объекта query массивом ([rest.ts:201-205](src/rest/rest.ts#L201-L205)); поле схемы length получает 2. Хватит Object.create(null) или пропуска ключа, как в mergeSafe.

12. Невалидный JSON-RPC запрос без `id` остаётся без ответа ([jsonrpc.ts:115-123](src/jsonrpc/jsonrpc.ts#L115-L123)). Пример из спеки (`{"jsonrpc":"2.0","method":1}`) требует ошибку -32600 с id: null. Это зафиксировано в conformance-тесте как намеренное, но со спекой расходится.

13. WS-клиент: вызов может зависнуть (по чтению кода). Ответ с id: null не коррелируется, таймаута нет. Два клиента на одном сокете оба считают id с 1 и могут получить чужие ответы ([client/index.ts:131-135](src/client/index.ts#L131-L135)).

14. Упаковка и документация.
    - agentTools недостижим: сабпата ./tools в exports нет, хотя [src/index.ts](src/index.ts#L2-L4) обещает его через сабпаты.
    - v2-тип Format и кодек json не экспортируются; корневой Format — это тип из v1, а MIGRATION предлагает писать свои форматы.
    - "license": "Apache License 2.0" — не SPDX, нужно Apache-2.0.
    - Скрипт dev ссылается на несуществующий src/tests.ts.
    - CI нет, а lint запускается с --fix.
    - «Known gaps» в [MIGRATION.md](MIGRATION.md#L630) устарели: middleware вокруг стримов и корреляция в WS-клиенте уже сделаны.
    - В [tests/sveltekit/src/routes/v2/rest/+page.ts:6](tests/sveltekit/src/routes/v2/rest/+page.ts#L6) остался отладочный console.log(doc).

Перед публикацией беты я бы закрыл пункты 1–5 и принял решение по п. 6. Могу взяться за фиксы с регрессионными тестами — скажите, с каких начать.