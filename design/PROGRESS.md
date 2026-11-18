# Прогресс v2.0 по спеке

> Компаньон к [`ROADMAP.md`](./ROADMAP.md) и дизайн-докам (`design/v2-registration.md`,
> `design/v2-exec-pipeline.md`, `design/v2-transport.md`). Статус по фактическому коду, а не по
> намерениям. Два трека: **src** — фактический рантайм; **спайк** — compile-checked примеры в
> `design/` (проверены `tsc --strict` и живым прогоном, но в src не перенесены, форма не одобрена).

## 1. Версии и миграция (v1 deprecated → v2)

- [x] Рантайм физически вынесен в `src/v1`, сборка в `dist/v1` (корень `.` пока на v1).
- [ ] `@deprecated` на публичных v1-экспортах — отложено до готовности v2.
- [ ] `exports` для v2 и фасада `./v1`, прогон `publint`/`attw`.
- [x] Карта экспорта и имена зафиксированы в [`v2-architecture.md`](./v2-architecture.md): корневой
      фасад `.` + листья (`schemas/{zod,valibot,yup}`, `client`, `core`); `compose`/`http`/`del`.
- [ ] Переключение корня `.` на v2 + v2-entries в tsdown + `dist`-раскладка (release-шаг).

## 2. Регистрация (schema-first, без декораторов)

- [x] `static $method = fn({ in, out, use })`, тип метода из фантомного `$method.fn` (тип `Fn`).
- [x] Обработчики всегда async: `(input) => Promise<Out>`.
- [x] **src:** `compose({ … }, { inject, schemas })` → `Core` (`instantiate/call/notify/endpoints`).
      Легаси `toRPC`/`Composer`/`ToRPCOptions` **полностью удалены** из src; конверт — в `jsonrpc`-биндинге.
      v2-тесты на `compose` + `jsonrpc` (helper `src/test-utils.ts`, envelope).
- [x] DI через конструктор + строгая типизация `Injector<S>` (public parameter-properties).
      `inject` опционален для сервисов без зависимостей (`compose({ Service })`); обязателен при наличии deps.
- [x] `Client` из классов: Promise-wrapped, `#`/`private` исключены.
- [x] simple-эндпоинты без `$method` (обход прототипа, приватность через `#`).
- [x] per-fn middleware `use`.
- [x] **src:** класс протокол-согласован — `compose` бросает ошибку при смешении REST (`get/post`)
      и RPC (`fn/stream`) деклараций в одном классе; разнести по разным сервисам. Роутинг решает
      биндинг (rest — по пути, jsonrpc/mcp — по имени), composer — плоский реестр `call(method)`.
- [x] **src:** типы разнесены по слоям (2026-11-17): `core/types` (CoreError, Middleware,
      Contract/Fn, DI, Core/ComposeOptions/Endpoint, Client-проекция), `format/types` (Format),
      `tools/types` (AgentTool), `protocol/jsonrpc/types` (RPC-wire, ErrorObject). Общий `types.ts` —
      только сквозные контракты (AnySchema/InferOutput, SchemaAdapter, RestMeta, транспортный шов).
      `Call` без vestigial `id`. Фасад реэкспортит типы слоёв — публичная поверхность не изменилась.
- [x] **src:** REST-декларации `get/post/…(path, { path?, query?, body?, resp })` в `protocol/rest` —
      части вместо плоского `in`, авто-path из шаблона, `resp` — карта статусов (FastAPI `responses`).
- [x] **src:** нейтральные поля (`desc`/`summary`/`tags`/`deprecated`) в `RestContract`, читают генераторы.
- [ ] `z.tuple([...])` — позиционные вызовы (открытый вопрос).

## 3. Единый источник валидации (schema-agnostic)

- [x] Ядро на вендореном `AnySchema` (Standard Schema v1, async `validate`).
- [x] Native `~standard` напрямую: zod 4 (devDep `zod`, алиас `zod4` убран за ненадобностью), valibot, arktype.
- [x] yup shim (`validators/yup`) — мост для библиотек без `~standard`.
- [x] zod 3 выпилен (шим, тест, `zod` и `@anatine/zod-mock` из зависимостей).
- [x] **src:** слой `schemas/` — `defaultSchemas` (generic ~standard), `flatToolSchema`, `packToolArgs`;
      вендорный лист `schemas/zod` (`ZodAdapter`, нативные zod-схемы для LangChain). `SchemaAdapter`
      (`jsonSchema`/`isObject`/`flatObject`/`wrapScalar`/`string`) — в types, регистрируется в `compose({ schemas })`.
- [x] generate/биндинги/tools берут конвертер из `core.schemas` (fallback `defaultSchemas`);
      `opts.jsonSchema` — точечный override (проверено по коду 2026-11-18).
- [ ] Typia — нужен compiler-трансформер (отдельная инфраструктурная задача).

## 4. Exec-пайплайн

- [x] `call/notify` — ядро транспорт-агностично (src); JSON-RPC-конверт (exec-подобный) —
      в jsonrpc-биндинге, тесты через envelope-helper.
- [x] normalize → route → middleware-цепочка (рекурсия) → invoke.
- [x] validate(in) → invoke → validate(out) (один валидатор). **out-валидация opt-in** через
      `compose({ validateOut: true })`; `out` всегда задаёт тип возврата, рантайм-проверка по флагу.
- [x] **Нативные ошибки (2026-11-17): `Result` удалён.** Core бросает свою протокол-нейтральную
      `CoreError(kind, message, data?)` — kinds `not-found`/`invalid-params`/`invalid-output` (types);
      ошибки обработчика летят как есть. Middleware — onion `(ctx, next) => value`, short-circuit — throw.
      JSON-RPC-модель ошибок (`ErrorCode` + `RpcError(code, data?, status?)`) и конверт
      (`toError`/`toWire`; `rpcResult` удалён при переносе проекций 2026-11-18) живут в
      `protocol/jsonrpc/jsonrpc.ts`; **mcp — соседний
      файл семейства, импортирует провод как JSON-RPC-профиль, не пир** (объединены в папку
      `jsonrpc/` с публичным index.ts по решению пользователя 2026-11-17). `shared` удалён —
      content-type инлайнится в ответах. Биндинги мапят: jsonrpc/mcp —
      `toError` (kind → код, error-конверт / isError-контент), rest — kind → статус (422/500)
      напрямую без JSON-RPC-модели, capnweb — нативный throw. `ErrorObject` — wire-форма.
- [x] Batch коррелируется по id, notification — без ответа.
- [x] **src:** ядро `Core` без `exec` — `call/notify/endpoints` + `schemas`; тулы — отдельный
      `agentTools(composer)` (не метод ядра). JSON-RPC-конверт (normalize/toWire/batch) — в `jsonrpc`.
- [ ] Клиентская граница `batch(...)` с per-item значением/ошибкой — не начата (ждёт client).
- [x] **src:** изоляция ctx в batch — per-call копия в `jsonrpc` (мутации не протекают).
- [x] **src:** `paramNames` ищет `constructor(` (баг класса без конструктора исправлен); warning
      при схеме без обработчика (`warnMissingHandlers`, probe-инстанс). Минификация DI — отдельно.
- [ ] Типизированный `ctx` (`Composer<Ctx>` обещан в exec-доке; сейчас везде `unknown`/`any`).

## 5. Транспорт (call / notify / stream)

- [x] call / notify на серверной части (src core gasket); JSON-RPC-конверт — в jsonrpc-биндинге.
- [x] **src:** слой `protocol/` — `jsonrpc/` семейство с публичным index.ts (jsonrpc-биндинг +
      провод + mcp-профиль), `rest`, `capnweb`; `shared` удалён (content-type инлайнится).
      REST-сахар `get/post/put/patch/del/http` + `RestContract` — в `protocol/rest`.
- [x] **src:** REST — роутинг по шаблону, срезы `{path,query,body}`, `resp`-карта → статусы,
      ошибка валидации → 422; docs-эндпоинты транзитивны (`/openapi.json`, `/docs`, `/redoc`).
- [x] **src:** capnweb-биндинг `capnweb(composer)` + `capability`-маркер (`Symbol`, `{$cap:id}` на проводе);
      lifecycle — `release(capId)` / `dispose()` сессии. CAP-обёртка — в биндинге (wire-трансформация,
      не зависит от `validateOut`). Авто-refcount — позже.
- [x] **src:** слой `transport/` — `fromSvelteKit` (fetch `Response`, DOM-lib в tsconfig) /
      `fromExpress` (структурные req/res) / `fromWs` + `Socket`, protocol-agnostic, потребляют
      проекции протокола ({ http } / { message }), format-ручка.
- [x] **src: Binding на уровне адаптера — проекции протоколов** (2026-11-18, 49 тестов):
      `MessageBinding`/`HttpProtocol`/`MessageProtocol` — в types.ts (биндинг = модель взаимодействия
      транспорта, не контракт на протокол; словарь http/message, stream — спайк 10). Фабрики отдают
      проекции: `rest → { http }`; `jsonrpc/mcp → { message, http }` (мост `messageToHttp` —
      `protocol/message.ts`, встроен в фабрику, не пользовательский код); capnweb `ServerSession`
      обрастает message/http (resolve/release/dispose сохранены). Адаптеры стабильны: fromSvelteKit/
      fromExpress требуют { http }, fromWs — { message }; REST × WS — ошибка типов. Поведение:
      jsonrpc batch из одних notification → 204 (спека JSON-RPC; раньше было 200 []).
- [ ] **спайк:** capnweb-клиент `connect<S>` (pipelining) — живёт в спайке, ждёт слой client.
- [x] **src: stream — третий глагол + проекция** (2026-11-18, 62 теста): `stream({in,event})`
      в core (один compose рядом с fn), `Core.stream(method, params, {ctx,signal})` → голые
      `AsyncIterable`; валидация входа и каждого события, отмена нативная (signal → AbortError,
      return()/break → finally-cleanup), DI через конструктор (this.ctx в генераторе).
      `StreamBinding/StreamProtocol` — types, протокол `events` (AG-UI-стиль, только stream),
      адаптер `fromWsStream` ({cancel:true} → return(); ошибка → error-фрейм; одна подписка на сокет).
      call по stream-методу → CoreError (глагол не тот). Unary-генераторы (openrpc/mcpTools/
      agentTools) stream исключают; AsyncAPI получил реальный источник событий.
      Открыто: backpressure, мультиплексирование подписок по id, middleware вокруг stream,
      generic SSE-адаптер.
- [x] **Значение-уровневый шов + format-ручка перенесены в src** (2026-11-17, 44 теста):
      `TransportRequest.body: unknown` / `TransportResponse.body: unknown + raw`, `Format.unit`
      (text/bytes); generic-адаптеры `fromSvelteKit`/`fromExpress` с format-ручкой (default json,
      сырое тело + раннее извлечение + formdata read-режим + docs raw-escape); биндинги
      jsonrpc/rest/mcp над значениями (формат убран из биндингов, конверт toWire/toError сохранён).
- [ ] Форматы: реальные бинарные кодеки MessagePack/CBOR/NDJSON (`Format<Uint8Array>`, unit bytes)
      + devalue — пока mock-кодеки в спайке `v2-value.*`. Байтовый спайк `v2-bytes.*` удалён (superseded).
- [ ] Клиентский рантайм: типизированный JSON-RPC/REST-клиент над проводом (capnweb `connect` — частный случай).

## 6. Генерация артефактов

- [x] **src:** слой `generate/` — `openapi`/`openrpc`/`mcpTools`/`asyncapi` из одного реестра `endpoints()`;
      транзитивны протоколу (REST→OpenAPI, fn→OpenRPC/MCP, stream→AsyncAPI-гипотеза). Конвертер из `core.schemas`.
- [x] **src:** слой `tools/` — `agentTools(composer)` (отдельная функция, не метод ядра): готовые тулы
      для LangChain in-process (`schema`/`invoke`/`func`), общий `packToolArgs` с mcp-биндингом.
- [x] **src:** слой `format/` — `json: Format<string>`; `Format<Raw>` generic по типу провода.
- [x] **src:** MCP-биндинг `mcp(composer)` (tools/list + tools/call); артефакты-примеры: `v2-catalog.{openapi,openrpc,mcp}.json`.
- [x] **src:** MCP `initialize`-handshake (protocolVersion-негоциация, capabilities.tools, serverInfo)
      + `ping` + `notifications/initialized`. Реальный клиент теперь подключается.
- [ ] MCP — только tools-capability: resources/prompts/sampling/list_changed/пагинация — нет.
- [x] AsyncAPI — реальный источник (2026-11-18): канал на stream-эндпоинт (`contract.event`),
      send=in, receive=event; адрес = Service.method, override — `contract.stream.channel`.
- [ ] JSON Schema для не-нативных валидаторов (yup) — шов есть, конвертация не сделана.
- [ ] A2A Agent Card / манифесты agent-протоколов — не начаты.

## 7. Долги по типам и ошибкам

- [x] Честный `Promise<Returned>` на клиенте (`Client`).
- [ ] Типизированные ошибки (контракт) и per-item ошибки batch на клиенте.
- [ ] REST: схемы ошибок в `resp` документационные (тело не генерируется/не валидируется);
      редиректы/headers/cookies отсутствуют (v1 `3xx`-костыль выпилен, замены нет).
- [x] capnweb: ошибки больше не теряют контекст — нативный throw `CoreError`/ошибки обработчика
      (закрыто удалением `Result`, 2026-11-17).

## Примеры и спайки (design/examples/)

**Реорганизация (2026-11-17):** примеры собраны в `design/examples/` — прогрессия от простого
к сложному (01→07), от default к custom; общие тривиальные классы (`shared.ts`: Math/Catalog/Echo/
Ticker/Counter), mock-кодеки (`codecs.ts`), механики спайков (`helpers/`). Индекс — `examples/README.md`.
Старые `example.ts`/`example.rest.ts`/`v2-*.example.ts` свёрнуты в нумерованные примеры; продвинутые
переиспользуют базовые классы. Superseded-кластер удалён ранее (восстановим из git). Все 10 примеров
compile-checked и прогнаны живьём.

**В src (примеры 01–06, 09–10):**
- 01 rpc, 02 rest — базовые декларации (fn / get-post) + биндинги + транспорт, default json, docs.
- 03 мультипротокол — один compose → rest/jsonrpc/mcp + agentTools (один реестр).
- 04 форматы — **значение-уровневый шов + format-ручка generic-адаптера (перенесено в src)**:
  json → devalue/msgpack сменой кодека (протокол один, без матрицы протокол×формат), formdata
  read-режим, раннее извлечение тела (format только encode ответа), docs raw-escape. Причинность:
  тело приходит сырым, парсит адаптер на границе (не клиент/handler).
- 05 websocket — **message-шов в src** (перенос 2026-11-18): jsonrpc-проекции { message, http },
  fromSvelteKit + fromWs поверх одного протокола; `helpers/message` сжат до демо-LoopbackSocket.
  Прогнан: HTTP/WS result 5, notification → 0 фреймов.
- 06 stream — **третий глагол в src** (перенос 2026-11-18): stream({in,event}) + compose.stream,
  голые события, отмена + cleanup, нативные ошибки, DI. Прогнан: countdown, abort→AbortError,
  invalid-params.
- 09 protocol-bindings — **Binding на уровне адаптера в src** (перенос 2026-11-18): проекции
  rest/jsonrpc/mcp/capnweb + fromSvelteKit/fromWs, мост встроен в фабрики — пользователь не пишет
  кастомный binding; REST × WS — ошибка типов. `helpers/bindings` удалён (весь в src). Прогнан:
  REST/jsonrpc/mcp → HTTP, jsonrpc → WS (тот же протокол), capnweb batch → [5].
- 10 stream-projection — **stream-модель в src** (перенос 2026-11-18): StreamBinding/StreamProtocol
  + events + fromWsStream; аддитивность доказана (старые протоколы/адаптеры не тронуты), один
  compose (fn+stream рядом), композиция способностей spread'ом. `helpers/{stream,stream-bindings}`
  удалены. Прогнан: подписка→3 события+cleanup, cancel→0 фреймов, invalid→error-фрейм, hybrid.

**Активные спайки (продвинутые, форма не одобрена, в src ещё нет):**
- 07 capnweb + `helpers/capnweb` — capnweb-**клиент** `connect<S>` (pipelining, capabilities по ссылке);
  серверный биндинг уже в src. Прогнан: pipelining, capability-стаб, цепочка одним round trip.
- 08 mcp-sse + `helpers/mcp-transport` — **MCP Streamable HTTP** (закрывает пробел 03: POST-only
  недостаточно): сессии (`Mcp-Session-Id`), `POST → json | 202`, `GET → SSE` (server→client поток),
  `DELETE → close`, server-push в сессию. Поверх mcp(composer).message (message-шов в src).
  Пользователь вешает обработчик на GET/POST/DELETE. Прогнан: initialize→session, tools/call→42,
  notification→202, GET SSE→event (list_changed), DELETE→204. Схождение stream-глагола +
  SSE-адаптера + session-роутера.

## Gap-ревью перед переносом в src (приоритеты)

- **Разблокировать заголовок v2:** stream — закрыт (глагол + проекция в src, 2026-11-18);
      клиентский рантайм — остался. Серверная часть транспортной ставки закрыта полностью.
- **Правдивость заявлений:** MCP `initialize` — закрыт (handshake в src); авто-refcount capability-реестра
      capnweb — нет (ручные `release`/`dispose` есть; сессия без dispose течёт).
- **Тихие продакшен-риски:** DI через `paramNames(fn.toString())` молча ломается при минификации
      бандла потребителя (нужен unbuilt `.ts`/jiti или явные ключи inject); класс без конструктора —
      баг исправлен (`paramNames` ищет `constructor(`); ctx есть в `invoke(args, ctx)`, но func-обёртка
      LangChain его не несёт («от чьего имени агент»).
- **Порядок:** дизайн-доки сведены со спайками, карта exports зафиксирована (v2-architecture.md),
      серверная вертикаль в src (проекции + адаптеры + stream, 2026-11-18). Осталось: client, затем release-шаг.
- **Безопасность:** docs публичны по умолчанию, нет `securitySchemes`/auth-истории, MCP-аннотации —
      подсказки не enforcement, capability без lifetime/scope.

## Тесты

- [x] **Ко-локация в src по слоям** (62 теста, 2026-11-18): `core/{core,register,stream}.test`,
      `schemas/{schemas,validators}.test`, `generate/generate.test`, `tools/tools.test`,
      `protocol/{jsonrpc,protocol,capnweb,events}.test`, `transport/transport.test`.
      Общий helper — `src/test-utils.ts` (envelope). vitest include `src/**/*.test.ts`; `tsconfig.build.json`
      исключает тесты из dts-emit. typecheck (`tsc --noEmit`) покрывает и тесты.
- [x] Примеры `design/examples/` (01→10, общие классы `shared.ts`) — compile-checked против src, прогнаны живьём.
- [ ] Продвинутые спайки `examples/helpers/{capnweb,mcp-transport}` (07/08) —
      compile-checked + ручной прогон, vitest пока нет.
- [ ] v1 `batch`/`spec` — падают (6 тестов, pre-existing; проверено на чистом src 2026-11-18), не чинил.

## Главная ставка / риски

- Ставка не изменилась: одна схема → типы + рантайм-валидация + JSON Schema → OpenRPC/OpenAPI/MCP/тулы.
  Фундамент (регистрация + валидация + call/notify/stream) готов; генерация, протоколы-проекции
  и транспорт **в src**; клиент — не начат.
- Главный риск выпуска — v1-фасад (`@deprecated`, `exports`, `publint`/`attw`).
- Самые большие незакрытые куски — клиентский рантайм (вторая половина заголовка п.3);
  авто-refcount capnweb, MCP resources/prompts/sampling, минификация DI и ctx func-тулов (тихие риски);
  stream-довески: backpressure, мультиплексирование подписок, middleware вокруг stream, generic SSE.

## Не проверял

- `publint`/`attw` и полный `pnpm build` (tsdown/terser) — не гонял; только `tsc --noEmit` и vitest.
- Реальный MCP-handshake живым клиентом, WS/SSE вживую, браузерный рендер docs.
- Влияние минификации на DI (`paramNames`).