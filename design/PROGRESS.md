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
      v2-тесты на `compose` + `jsonrpc` (helper `tests/v2/rpc.ts`).
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
- [ ] generate/биндинги/tools в src ещё берут конвертер параметром — переезд на `core.schemas` при переносе слоёв.
- [ ] Typia — нужен compiler-трансформер (отдельная инфраструктурная задача).

## 4. Exec-пайплайн

- [x] `exec(body, { ctx })` — ядро транспорт-агностично (src).
- [x] normalize → route → middleware-цепочка (рекурсия) → invoke.
- [x] validate(in) → invoke → validate(out) (один валидатор). **out-валидация opt-in** через
      `compose({ validateOut: true })`; `out` всегда задаёт тип возврата, рантайм-проверка по флагу.
- [x] **Нативные ошибки (2026-11-17): `Result` удалён.** Core бросает свою протокол-нейтральную
      `CoreError(kind, message, data?)` — kinds `not-found`/`invalid-params`/`invalid-output` (types);
      ошибки обработчика летят как есть. Middleware — onion `(ctx, next) => value`, short-circuit — throw.
      JSON-RPC-модель ошибок (`ErrorCode` + `RpcError(code, data?, status?)`) и конверт
      (`toError`/`toWire`/`rpcResult`) живут в `protocol/jsonrpc/jsonrpc.ts`; **mcp — соседний
      файл семейства, импортирует провод как JSON-RPC-профиль, не пир** (объединены в папку
      `jsonrpc/` с публичным index.ts по решению пользователя 2026-11-17). `shared` удалён —
      content-type инлайнится в ответах. Биндинги мапят: jsonrpc/mcp —
      `toError` (kind → код, error-конверт / isError-контент), rest — kind → статус (422/500)
      напрямую без JSON-RPC-модели, capnweb — нативный throw. `ErrorObject` — wire-форма.
- [x] Batch коррелируется по id, notification — без ответа.
- [x] **src:** ядро `Core` без `exec` — `call/notify/endpoints` + `schemas`; тулы — отдельный
      `agentTools(composer)` (не метод ядра). JSON-RPC-конверт (normalize/toWire/batch) — в `jsonrpc`.
- [ ] Клиентская граница `batch(...)` с per-item значением/ошибкой — не начата (ждёт client).
- [x] **src:** изоляция ctx в batch — per-call копия в `exec` и `jsonrpc` (мутации не протекают).
- [x] **src:** `paramNames` ищет `constructor(` (баг класса без конструктора исправлен); warning
      при схеме без обработчика (`warnMissingHandlers`, probe-инстанс). Минификация DI — отдельно.
- [ ] Типизированный `ctx` (`Composer<Ctx>` обещан в exec-доке; сейчас везде `unknown`/`any`).

## 5. Транспорт (call / notify / stream)

- [x] call / notify на серверной части (src `exec`; спайк — gasket `Core`).
- [x] **src:** слой `protocol/` — `jsonrpc/` семейство с публичным index.ts (jsonrpc-биндинг +
      провод + mcp-профиль), `rest`, `capnweb`; `shared` удалён (content-type инлайнится).
      REST-сахар `get/post/put/patch/del/http` + `RestContract` — в `protocol/rest`.
- [x] **src:** REST — роутинг по шаблону, срезы `{path,query,body}`, `resp`-карта → статусы,
      ошибка валидации → 422; docs-эндпоинты транзитивны (`/openapi.json`, `/docs`, `/redoc`).
- [x] **src:** capnweb-биндинг `capnweb(composer)` + `capability`-маркер (`Symbol`, `{$cap:id}` на проводе);
      lifecycle — `release(capId)` / `dispose()` сессии. CAP-обёртка — в биндинге (wire-трансформация,
      не зависит от `validateOut`). Авто-refcount — позже.
- [x] **src:** слой `transport/` — `fromSvelteKit` (fetch `Response`, DOM-lib в tsconfig) /
      `fromExpress` (структурные req/res), protocol-agnostic, гоняют байты в `Binding`.
- [ ] **спайк:** capnweb-клиент `connect<S>` (pipelining) — живёт в спайке, ждёт слой client.
- [ ] **stream — не начат.** Блокирует SSE/WS, настоящий AsyncAPI, A2A/AG-UI/ACP, RSocket.
      Форма `AsyncIterable<Event>`, отмена, backpressure не решены.
- [ ] Форматы: `Format<Raw = string>` generic (не зашит на строки); бинарные MessagePack/CBOR/NDJSON
      (`Format<Uint8Array>`) + обобщение биндингов/транспорта до байтов. **Спайк варианта A
      (байтовый шов) прогнан** — `v2-bytes.*`: `TransportRequest.bytes()`, `body: Uint8Array | null`,
      `Format<Uint8Array>` на границе биндинга, json поверх байтов + mock-бинарный кодек,
      fetch/express-адаптеры нативно. Перенос в src не одобрен (форма — спайк).
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
- [ ] AsyncAPI — гипотеза (`stream:{channel}`), реального источника событий нет (ждёт stream).
- [ ] JSON Schema для не-нативных валидаторов (yup) — шов есть, конвертация не сделана.
- [ ] A2A Agent Card / манифесты agent-протоколов — не начаты.

## 7. Долги по типам и ошибкам

- [x] Честный `Promise<Returned>` на клиенте (`Client`).
- [ ] Типизированные ошибки (контракт) и per-item ошибки batch на клиенте.
- [ ] REST: схемы ошибок в `resp` документационные (тело не генерируется/не валидируется);
      редиректы/headers/cookies отсутствуют (v1 `3xx`-костыль выпилен, замены нет).
- [x] capnweb: ошибки больше не теряют контекст — нативный throw `CoreError`/ошибки обработчика
      (закрыто удалением `Result`, 2026-11-17).

## Дизайн-спайки (design/)

**Чистка выполнена:** superseded-кластер удалён (функциональность перенесена в src, легаси `toRPC`
выпилен из src полностью): `helpers/example`, `v2-transport.*`, `v2-generate.*`, `v2-schemas.helpers`,
`v2-mcp.example`, `v2-types.spike`, `v2-schema-agnostic.spike`. Восстановимы из git.

**Активные спайки (форма не одобрена, в src ещё нет):**
- `v2-stream.{helpers,example}.ts` — третий глагол: `stream({ in, event })`, async-генератор,
  нативные ошибки (`CoreError`/`AbortError`), один `compose`. Прогнан живьём. `CoreError` теперь
  общий с src (реэкспорт из types, локальный класс удалён).
- `v2-capnp.{helpers,example}.ts` — capnweb-**клиент** `connect<S>` (pipelining, capabilities);
  серверный биндинг уже в src. Импорты мигрированы на src. Имена файлов `v2-capnp.*` расходятся
  с именем биндинга `capnweb` — переименование не одобрено.
- `v2-bytes.{helpers,example}.ts` — байтовый транспортный шов (вариант A, одобрен для спайка
  2026-11-17): `bytes()`/`Uint8Array`-тело, `Format<Uint8Array>`, json+mock-binary кодеки,
  унарный jsonrpc-биндинг (конверт/`toError` из src), fetch/express-адаптеры. Прогнан живьём
  (оба формата, CoreError → -32602, fetch Response). Ядро не меняется; перенос в src не одобрен.
- Артефакты-примеры: `v2-catalog.{openapi,openrpc,mcp}.json` (mcp.json устарел — fn-only, без аннотаций).

## Gap-ревью перед переносом в src (приоритеты)

- **Разблокировать заголовок v2:** `stream` + клиентский рантайм — транспортная ставка закрыта наполовину.
- **Правдивость заявлений:** MCP `initialize` (иначе не подключается); освобождение capability-реестра
      capnweb (сейчас никогда не чистится — утечка памяти на сервере).
- **Тихие продакшен-риски:** DI через `paramNames(fn.toString())` молча ломается при минификации
      бандла потребителя (нужен unbuilt `.ts`/jiti или явные ключи inject); класс без конструктора
      ломает парсер (баг найден, в src не исправлен); агентские тулы не несут `ctx` («от чьего имени агент»).
- **Порядок:** свести дизайн-доки с спайками (resp/desc/SchemaAdapter/capnweb/транзитивность не описаны)
      и спроектировать карту exports — до переноса в src.
- **Безопасность:** docs публичны по умолчанию, нет `securitySchemes`/auth-истории, MCP-аннотации —
      подсказки не enforcement, capability без lifetime/scope.

## Тесты

- [x] **Ко-локация в src по слоям** (44 теста): `core/{core,register}.test`, `schemas/{schemas,validators}.test`,
      `generate/generate.test`, `tools/tools.test`, `protocol/{jsonrpc,protocol,capnweb}.test`, `transport/transport.test`.
      Общий helper — `src/test-utils.ts` (envelope). vitest include `src/**/*.test.ts`; `tsconfig.build.json`
      исключает тесты из dts-emit. typecheck (`tsc --noEmit`) покрывает и тесты.
- [x] Канонические примеры `design/example.ts` (fn), `design/example.rest.ts` (REST) — compile-checked против src.
- [ ] Активные спайки `v2-stream.*`/`v2-capnp.*` — compile-checked + ручной прогон, vitest пока нет.
- [ ] v1 `batch`/`spec` — падают (pre-existing shared-state в `Composer`), не чинил.

## Главная ставка / риски

- Ставка не изменилась: одна схема → типы + рантайм-валидация + JSON Schema → OpenRPC/OpenAPI/MCP/тулы.
  Фундамент (регистрация + валидация + exec) готов; генерация и транспортный слой закрыты **спайками**.
- Главный риск выпуска — v1-фасад (`@deprecated`, `exports`, `publint`/`attw`).
- Самые большие незакрытые куски — `stream` и клиентский рантайм (заголовок п.3), MCP-handshake и
  lifecycle capabilities (правдивость), минификация DI и ctx тулов (тихие риски).

## Не проверял

- `publint`/`attw` и полный `pnpm build` (tsdown/terser) — не гонял; только `tsc --noEmit` и vitest.
- Реальный MCP-handshake живым клиентом, WS/SSE вживую, браузерный рендер docs.
- Влияние минификации на DI (`paramNames`).