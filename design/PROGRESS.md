# Прогресс v2.0 по спеке

> Компаньон к [`ROADMAP.md`](./ROADMAP.md) и дизайн-докам (`design/v2-registration.md`,
> `design/v2-exec-pipeline.md`, `design/v2-transport.md`). Статус по фактическому коду, а не по
> намерениям. Два трека: **src** — фактический рантайм; **спайк** — compile-checked примеры в
> `design/` (проверены `tsc --strict` и живым прогоном, но в src не перенесены, форма не одобрена).

## 1. Версии и миграция (v1 deprecated → v2)

- [x] Рантайм физически вынесен в `src/v1`, сборка в `dist/v1` (корень `.` пока на v1).
- [ ] `@deprecated` на публичных v1-экспортах — отложено до готовности v2.
- [ ] `exports` для v2 и фасада `./v1`, прогон `publint`/`attw`.
- [ ] Карта экспорта v2 не спроектирована: сабпаты (`/rest`, `/mcp`, `/capnweb`, `/schemas/zod`?),
      публичные имена (`compose` vs `toRPC`, `http` vs `rest`, `del`) не утверждены.

## 2. Регистрация (schema-first, без декораторов)

- [x] `static $method = fn({ in, out, use })`, тип метода из фантомного `$method.fn` (тип `Fn`).
- [x] Обработчики всегда async: `(input) => Promise<Out>`.
- [x] `toRPC({ … }, { inject })` → `{ instantiate, exec }` (src; в спайке предложено `compose` → `Core`).
- [x] DI через конструктор + строгая типизация `Injector<S>` (public parameter-properties).
- [x] `Client` из классов: Promise-wrapped, `#`/`private` исключены.
- [x] simple-эндпоинты без `$method` (обход прототипа, приватность через `#`).
- [x] per-fn middleware `use`.
- [x] **спайк:** REST-декларации `get/post/…(path, { path?, query?, body?, resp })` — части вместо
      плоского `in`, авто-path из шаблона, `resp` — карта статусов (FastAPI `responses`), `desc`.
- [ ] `z.tuple([...])` — позиционные вызовы (открытый вопрос).
- [ ] Нейтральные поля в src-контракте (`desc`/`tags`/`deprecated`) — в спайке есть, в src нет.

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
- [x] validate(in) → invoke → validate(out) (один валидатор).
- [x] Типизированный `Result` + `ErrorObject` (InvalidParams/MethodNotFound/InternalError).
- [x] Batch коррелируется по id, notification — без ответа.
- [x] **спайк:** ядро `Core` без `exec` — только `call/notify/endpoints` + `schemas` + `tools()`;
      JSON-RPC-конверт (normalize/toWire/batch) вынесен в биндинг `jsonrpc`.
- [ ] Клиентская граница `batch(...) => Result[]` — не начата.
- [ ] Изоляция ctx между элементами batch (один общий `opts.ctx`, мутации протекают).
- [ ] Типизированный `ctx` (`Composer<Ctx>` обещан в exec-доке; сейчас везде `unknown`/`any`).

## 5. Транспорт (call / notify / stream)

- [x] call / notify на серверной части (src `exec`; спайк — gasket `Core`).
- [x] **src:** слой `protocol/` — биндинги по имени протокола `jsonrpc`/`rest`/`mcp`/`capnweb`
      (+ `shared` helpers). REST-сахар `get/post/put/patch/del/http` + `RestContract` — в `protocol/rest`.
- [x] **src:** REST — роутинг по шаблону, срезы `{path,query,body}`, `resp`-карта → статусы,
      ошибка валидации → 422; docs-эндпоинты транзитивны (`/openapi.json`, `/docs`, `/redoc`).
- [x] **src:** capnweb-биндинг `capnweb(composer)` + `capability`-маркер (`Symbol`, `{$cap:id}` на проводе).
- [x] **src:** слой `transport/` — `fromSvelteKit` (fetch `Response`, DOM-lib в tsconfig) /
      `fromExpress` (структурные req/res), protocol-agnostic, гоняют байты в `Binding`.
- [ ] **спайк:** capnweb-клиент `connect<S>` (pipelining) — живёт в спайке, ждёт слой client.
- [ ] **stream — не начат.** Блокирует SSE/WS, настоящий AsyncAPI, A2A/AG-UI/ACP, RSocket.
      Форма `AsyncIterable<Event>`, отмена, backpressure не решены.
- [ ] Форматы: только текст; MessagePack/CBOR/NDJSON/binary/encryption — нужен байтовый шов `Format`.
- [ ] Клиентский рантайм: типизированный JSON-RPC/REST-клиент над проводом (capnweb `connect` — частный случай).

## 6. Генерация артефактов

- [x] **src:** слой `generate/` — `openapi`/`openrpc`/`mcpTools`/`asyncapi` из одного реестра `endpoints()`;
      транзитивны протоколу (REST→OpenAPI, fn→OpenRPC/MCP, stream→AsyncAPI-гипотеза). Конвертер из `core.schemas`.
- [x] **src:** слой `tools/` — `agentTools(composer)` (отдельная функция, не метод ядра): готовые тулы
      для LangChain in-process (`schema`/`invoke`/`func`), общий `packToolArgs` с mcp-биндингом.
- [x] **src:** слой `format/` — `json` (текстовый шов; байтовый под msgpack/cbor — позже).
- [x] **src:** MCP-биндинг `mcp(composer)` (tools/list + tools/call); артефакты-примеры: `v2-catalog.{openapi,openrpc,mcp}.json`.
- [ ] MCP — tools-subset, **нет `initialize`** (protocolVersion/capabilities/serverInfo): реальный
      клиент (Inspector/Claude Desktop) не подключится. Resources/prompts/list_changed/пагинация — нет.
- [ ] AsyncAPI — гипотеза (`stream:{channel}`), реального источника событий нет (ждёт stream).
- [ ] JSON Schema для не-нативных валидаторов (yup) — шов есть, конвертация не сделана.
- [ ] A2A Agent Card / манифесты agent-протоколов — не начаты.

## 7. Долги по типам и ошибкам

- [x] Честный `Promise<Returned>` на клиенте (`Client`).
- [ ] Типизированные ошибки (контракт) и per-item ошибки batch на клиенте.
- [ ] REST: схемы ошибок в `resp` документационные (тело не генерируется/не валидируется);
      редиректы/headers/cookies отсутствуют (v1 `3xx`-костыль выпилен, замены нет).
- [ ] capnweb: ошибки теряют `code/status` (просто `Error(message)`).

## Дизайн-спайки (design/, форма не одобрена, src не тронут)

- `v2-transport.{helpers,example}.ts` — ядро `compose`/`Core`, биндинги, транспорты, REST-части, docs.
- `v2-generate.{helpers,example}.ts` — генераторы OpenAPI/OpenRPC/MCP/AsyncAPI, `packToolArgs`.
- `v2-schemas.helpers.ts` — `SchemaAdapter`, `ZodAdapter`, `flatToolSchema`.
- `v2-capnp.{helpers,example}.ts` — capnweb-биндинг + `connect`, pipelining, capabilities.
- `v2-mcp.example.ts` — MCP-провод + `composer.tools()` для LangChain.
- Все проверены `tsc --strict` и живым прогоном (loopback/HTTP-дескрипторы). Имена файлов `v2-capnp.*`
      расходятся с именем биндинга `capnweb` — переименование не одобрено.

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

- [x] `tests/v2` — register/exec/validators/schemas/generate/tools/protocol/transport, 34 теста (src).
- [x] type-spike: `v2-types`.
- [ ] Спайки: compile-checked + ручной прогон, **vitest-покрытия новых слоёв нет**.
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