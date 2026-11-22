# Прогресс v2.0 по спеке

> Компаньон к [`ROADMAP.md`](./ROADMAP.md) и дизайн-докам (`design/v2-registration.md`,
> `design/v2-exec-pipeline.md`, `design/v2-transport.md`). Статус по фактическому коду, а не по
> намерениям. Два трека: **src** — фактический рантайм; **спайк** — compile-checked примеры в
> `design/` (проверены `tsc --strict` и живым прогоном, но в src не перенесены, форма не одобрена).

## Релиз 2.0.0-beta.1 — клиент + формат на эндпоинте (2026-11-20)

Клиентский рантайм перенесён в src, формат поднят на эндпоинт, release-конфиг собран. Версия
`2.0.0-beta.1`. Публикация — за пользователем: `pnpm publish --tag beta --no-git-checks`.

- **Клиент (`src/client`, сабпат `./client`):** протокол-специфичные конструкторы `jsonrpc`/`rest`
  (имена зеркалят серверные, модуль другой). Дженерик — **тип серверного биндинга**:
  `jsonrpc<typeof api>({ endpoint, format })` / `({ socket, format })`; `rest<typeof restApi>({ endpoint, doc, format })`.
  Init задаёт транспорт формой (`endpoint`→fetch, `socket`→ws); отдельных `client`/`fromFetch`/`fromWs` нет.
  Конструктор выводит сервисы+формат из типа биндинга, защищает протокол (`B extends MessageProtocol`/`HttpProtocol`)
  и формат (init.format против формата эндпоинта), wire-трансформирует возвраты. Ошибки нативные
  (`RpcError` / `Error+status`). notify/batch/stream/abort — следующие итерации.
- **Формат на эндпоинте:** `jsonrpc(composer, { format })` / `rest(composer, { format })` несут формат
  значением (`api.format`) и типом (`FormatTag<F>`); адаптеры читают его оттуда (`opts.format` — override
  для совместимости). Формат фиксирован per-endpoint (продакшен-эндпоинты одноформатные, вокруг json);
  per-call негоциация не используется. jsonrpc/rest — pluggable формат, mcp/capnweb — встроенный (позже).
- **Wire-типы (`src/format`):** `Format<Raw, F extends WireFn>`, `JsonWire` (Date→string рекурсивно),
  `ApplyWire`. Возврат клиента типизирован по формату эндпоинта: `Clock.now()` — string через json,
  Date через devalue. Бренд `WireFn.__brand` обязателен (без него фантомы структурно совместимы).
- **Release-конфиг (финально — объединённый реэкспорт, без суффиксов версии):** корень `.` = v1+v2
  (`src/index.ts`: `export * from './v1'` + v2-слои), `./client` = v1-клиент + v2-конструкторы
  (`src/client`: `export * from '../v1/client'` + jsonrpc/rest), `./middlewares`/`./validators`/`./specs`
  → v1. Никаких `./v1`/`./v2` сабпатов — старые пути сохранены, v2 добавлен реэкспортом (имена не
  пересекаются; коллизии `Middleware`/`Format`/`ErrorCode` — явный v2-реэкспорт перебивает star).
  `typesVersions` для legacy TS-резолва. zod — optional peer. tsdown `dts: true` (dts под js-чанки,
  attw internal resolution починен); v1 изолирован в `dist/v1`. `@deprecated` на v1: `Composer`,
  `toRPC`, `rpc`, `depends`, `val`, `client`, `RPC`.
- **tests/sveltekit — воспроизведение npm-публикации:** алиас `@chord/rpc: link:../..` резолвит
  старые пути через реальную exports-карту в dist (проверено импортом: root отдаёт Composer/rpc +
  compose/fn/jsonrpc/rest, client — client + jsonrpc/rest). Роуты сгруппированы по папкам:
  `routes/v1/*` (13 старых сценариев) и `routes/v2/*` (rpc + rest catch-all + OpenAPI через load);
  импорт из `@chord/rpc` (старые пути, без суффиксов), пути endpoint/редиректов обновлены под
  префиксы. v2-роуты typecheck чистые. zod только 4 (`zodToJsonSchema`→`z.toJSONSchema`).
  Pre-existing v1-ошибки svelte-check (implicit any, `Returned` не top-level, Locals) — baseline
  тестового кода, не регрессии.
- **Гейты:** 71/71 unit (62 слоя + 9 клиент), typecheck чистый, **publint All good**, **attw
  node10/node16-ESM/bundler 🟢** по всем сабпатам (node16-CJS ⚠️ — ESM-only по дизайму, engines node>=20).
  Пример 12 compile-checked + живой прогон. Superseded-спайки 13/14 + helpers/{client,format-types,format-guard}
  удалены (знания в src/client + примере 12).
- **Известное:** vitest threads-pool teardown-краш (Node 24 / vitest 1.6) — `pnpm test` надёжнее с
  `pool: 'forks'`; тесты функционально зелёные (single-fork exit 0). DI `paramNames(fn.toString())`
  ломается при минификации бандла потребителя (нужны явные ключи inject); клиентские имена методов —
  динамические proxy-строки, property mangling ломает адресацию (держать выключенным).

## TODO — продолжение (точка входа 2026-11-20)

**На подумать — первым делом в следующий раз (2026-11-21, clef Try it) — ЗАКРЫТО 2026-11-23, см. ниже:** скалярные `fn`
(`in: z.number()` и т.п.) в Try it не исполняются: `openrpc()` отдаёт один 'params'-дескриптор,
clef шлёт by-name карту `{params: value}`, а сервер ждёт голый скаляр → -32602. Стандартными
JSON-RPC params (by-name объект / by-position массив) скаляр не выражается. Варианты:
clef трактует одиночный 'params'-дескриптор как всё значение params (правка + релиз clef);
или скаляр оборачивается на сервере по образцу MCP `{ value }` (меняет wire); или оставить
как есть (доки рендерятся, исполнение — нет). Контекст: object-вход уже расложен per-property
(by-name), void/any → `params: []` — это работает и проверено; скаляр — осознанно отложен.
Рядом: simple-эндпоинты без `$method` (Greeter) не имеют схемы — параметры не документируются,
Try it шлёт пустой вызов.

**Обновление 2026-11-23 — трейдофф закрыт полностью: скаляр, tuple, массив-как-значение.**
Сверено по первоисточникам (JSON-RPC 2.0 §4.2, OpenRPC spec + meta-schema 1.14.6): `params`
MUST be Structured (Object/Array), by-position массив легален, голый скаляр — нет. Итоговый
проводной контракт (решение пользователя: «клиент гарантирует позиционные [a, b], массив [[…]]»):

- **object** → by-name карта, дескриптор per property, `paramStructure: 'by-name'` (без изменений).
- **tuple** (`z.tuple`, фиксированная длина) → позиционные аргументы: тип `Fn` раскрывает
  в `(...args)` обработчика, провод `[a, b]`, дескриптор на элемент (`arg0/arg1`, `required`
  по `minItems`, optional-хвост после обязательных — требование порядка OpenRPC), `'by-position'`.
- **обычный массив** (`z.array`) → **одиночное значение-массив**, не variadic: обработчик
  `(nums: number[])`, провод `[[…]]` (клиентский proxy оборачивает одиночный array-аргумент),
  дескриптор `arg0` с array-схемой, `'by-position'`. Голый массив `params` = позиционные
  аргументы (универсальное правило by-position) — для массива-значения каноническая форма `[[…]]`.
- **скаляр** → вырожденный tuple из одного аргумента: провод `[value]` (стандарт) или голый
  скаляр (текущий chord-клиент, сервер толерантен), дескриптор `arg0`, `'by-position'`.
  Имя `'params'` у дескриптора исчезло полностью.
- **void/any** → `params: []` (без изменений).

Механика сервера (`core.invoke`, без знания схемы — слои не нарушены): голый массив params →
spread в аргументы; невалидный одиночный массив распаковывается в значение (`[value]`/`[[…]]`),
если обе формы невалидны — ошибка от прямой. Simple-эндпоинты: то же распаковывание `[[…]]`.
`packToolArgs` (MCP/agentTools) распаковывает `{value}` — не затронут. **clef править не нужно**:
`paramsByName` (src/core/examples.ts) уже читает `paramStructure` и шлёт массив для by-position
(проверено по исходникам соседнего репозитория и CDN-бандлу). Демо: `Scalars` (скаляры + tuple
с optional-хвостом) и `Math.sumAll` в tests/sveltekit v2/rpc. Проверено живьём: спека, wire-вызовы
(обе формы скаляра, `[[1,2,3]]`→6), страница в браузере (sumAll=6 через типизированный клиент),
**clef Try it исполняет скаляр (upper→HELLO) и массив (sumAll [[0]]→0)**; 84/84 v2 unit-теста,
build/typecheck чистые, svelte-check v2 clean (53 v1 baseline).

Снято 2026-11-19. Детали — в записи спайка 06 и в разделе «Тесты» ниже; устройство
conformance-инфраструктуры — `src/protocol/mcp/tests/README.md`.

**Где остановились.** MCP 2026-07-28: поверхность `mcp(composer, {…})` + `fromSvelteKit(endpoint)`
(7 строк), домен публикует изменения через `publish({ kind })`. Официальный рефери и
fixture-контракт апстрима подключены: **127 passed / 44 failed checks, 23 из 37 scored-сценариев
проходят, baseline 14 записей, ratchet зелёный** (до fixture-контракта было 106/62 и 6 чистых).
Реализация в src **не перенесена**: `src/protocol/mcp/index.ts` пустой, тесты импортируют спайк
`design/examples/helpers/{mcp,http}` — временная зависимость src → design принята осознанно.

**Команды возобновления:** `pnpm test:mcp` (ratchet) · `pnpm test:mcp:report` (отчёт) ·
`npx vitest run src --exclude '**/mcp/tests/**'` (62 unit) · `npx tsc --noEmit`.

### Следующее — по payoff

- [ ] **MRTR (SEP-2322) — закрывает 12 из 14 оставшихся сценариев.** `resultType: 'input_required'`,
      `inputRequests`, `requestState`, multi-round, отказ на tampered-state, capability gating.
      Fixture-тулы `test_input_required_result_*` и `test_missing_capability` уже объявлены и ждут.
      **Вопрос формы (решить до кода):** как chord-обработчик возвращает «нужен ввод клиента» —
      отдельный тип возврата, маркер по образцу `capability()`, или throw?
      Не склонирован ещё `test_input_required_result_prompt` (MRTR на prompts/get).
- [ ] **`-32021` MissingRequiredClientCapability** — 2 оставшиеся проверки `server-stateless`:
      гейтинг по `_meta['io.modelcontextprotocol/clientCapabilities']` + HTTP 400.
- [ ] **Request-scoped `notifications/progress`** — 1 сценарий (`tools-call-with-progress`).
      Канал подписок есть; нужен progress, привязанный к потоку ответа конкретного запроса
      (`progressToken` из `_meta`), а не к подписке.

### Решения, блокирующие перенос в src

- [ ] **Дельта к шву (аддитивна, ждёт согласования):** `TransportRequest += headers?, signal?`;
      `fromSvelteKit(protocol) → handler` (каррирование, per-call форма сохранена перегрузкой);
      SSE-фрейминг, когда `body` — AsyncIterable; `body == null` → тела нет.
      Проверено: старые биндинги/адаптеры и примеры 01–05/09 не ломаются.
- [ ] **Passthrough CallToolResult** — сейчас эвристика по форме `content`-массива.
      Оставить эвристику или ввести явный маркер?
- [ ] **Resources/prompts через meta** (`mcp.resource` / `mcp.prompt` на `fn`) — постоянный
      словарь или отдельный declaration sugar? Ядро не менялось: `fn` пропускает meta в реестр.
- [ ] **`mcpTools` в src** не знает про resource/prompt-эндпоинты и `mcp.name` — спайк обходит
      фильтрованным view ядра + картой переименований. При переносе починить генератор.
- [ ] Судьба legacy `mcp()` (2025-06-18): замена на modern или dual-era на одном эндпоинте.
      Legacy обслуживает примеры 03/09.

### Не scored / позже

- [ ] `x-mcp-header` (SEP-2243): аннотировать fixture-тул, затем полная сверка `Mcp-Param-*`
      с телом (сейчас проверяется только кодировка/base64-сентинел).
- [ ] `json-schema-2020-12`: нужен hand-authored JSON Schema (`$defs`/`$anchor`/`allOf`/`if-then`) —
      zod такие ключевые слова не эмитит.
- [ ] Tasks-расширение (SEP-2663): 10 сценариев вне замороженного набора 2026-07-28.
- [ ] Backpressure канала подписок: очередь на подписку не ограничена (пересечение со спайком 11,
      который **под вопросом**).

### Грабли, на которые уже наступили

- **WARNING ≠ pass.** Pretty-сводка печатает `✓ N passed, 0 failed` для сценариев с WARNING
  (SHOULD-проверки), но reconciliation считает их непрохождением. Снятие таких строк с baseline
  по сводке делает прогон красным — они обязаны быть в baseline с пометкой `(WARNING)`.
- **Extension/pending нельзя baselined** при `--requirements 2026-07-28` — рефери пометит их stale.
- **Пин рефери точный** (`0.2.0-alpha.12`, как у апстрима): бамп пина и пересборка baseline —
  одним изменением.
- **Отмена async-генератора на `await` отложена, не потеряна.** Клиентский cancel не должен ждать
  чужой cleanup: `void it.return()` вместо `return it.return()` (замер 51ms → 0ms).
- `@types/node` добавлен в devDeps; `tsconfig.build.json` exclude `src/**/tests/**` — dts-emit
  проверен, tests не публикуются.
- v1 `batch`/`spec` — 6 pre-existing падений, не чинились.

## 1. Версии и миграция (v1 deprecated → v2)

- [x] Рантайм физически вынесен в `src/v1`, сборка в `dist/v1`.
- [x] `@deprecated` на публичных v1-экспортах (`Composer`/`toRPC`/`rpc`/`depends`/`val`/`client`/`RPC`).
- [x] `exports` для v2 и фасада `./v1`, прогон `publint`/`attw` (2026-11-20, см. раздел релиза).
- [x] Карта экспорта и имена зафиксированы в [`v2-architecture.md`](./v2-architecture.md): корневой
      фасад `.` + листья (`schemas/{zod,valibot,yup}`, `client`, `core`); `compose`/`http`/`del`.
- [x] Переключение корня `.` на v2 + v2-entries в tsdown + `dist`-раскладка (release-шаг, 2026-11-20).

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
      ошибка валидации → 422. **rest — чистый роутинг** (2026-11-20): авто-docs убраны — они
      предполагали корень (`url.pathname === '/docs'`), а binding может быть смонтирован на подроут
      (`/v2/rest/[...path]`), где docs недостижимы. Docs — отдельные binding'и (см. generate).
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
      **Форма ЗАФИКСИРОВАНА (2026-11-18); правки — с обоснованием/доказательством/альтернативами,
      не втихую.** Семантика раннего извлечения:
      значение на руках → message.handle (нативно, без dummy method/url; пример 04); HTTP-ответ
      с ранним телом в кастомном формате → адаптер opts.body; REST → всегда http.
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
- [x] Клиентский рантайм: `src/client` (2026-11-20), конструкторы `jsonrpc`/`rest` из `./client`,
      дженерик = тип серверного биндинга, формат-гард + wire-типы (см. раздел релиза). capnweb `connect` — позже.

## 6. Генерация артефактов

- [x] **src:** слой `generate/` — `openapi`/`openrpc`/`mcpTools`/`asyncapi` из одного реестра `endpoints()`;
      транзитивны протоколу (REST→OpenAPI, fn→OpenRPC/MCP, stream→AsyncAPI-гипотеза). Конвертер из `core.schemas`.
- [x] **src: генераторы — binding'и + UI-вьюеры** (2026-11-20): генераторы возвращают `Spec<T> =
      HttpProtocol & { document }` (`serveSpec`) — спеку отдают GET-эндпоинтом
      (`fromSvelteKit(openapi(composer), event)`), документ доступен как `.document`. Добавлены
      `swagger(composer, opts)` / `redoc(composer, opts)` — UI-binding'и поверх OpenAPI: документ вшит
      inline (`spec:`), отдельный openapi-маунт и CORS не нужны, путь маунта выбирает пользователь.
      Форма согласована: `swagger(core, opts)` как у остальных генераторов (не viewer по URL и не обёртка Spec).
- [x] **src: clef-вьюер вместо OpenRPC Playground** (2026-11-21): `clef(composer, { endpoint, transports })` —
      UI-binding поверх OpenRPC (`@chord-ts/clef` опубликован, CDN один файл): explorer + Try it-консоль,
      спека inline, `endpoint` — адрес JSON-RPC-binding'а для запросов из консоли. Hosted
      playground.open-rpc.org выпилен: clef живёт на странице пользователя — `PLAYGROUND_CORS` удалён
      из types/serveSpec/jsonrpc (CORS и OPTIONS-preflight больше не нужны). sveltekit-тест:
      `/v2/rpc/openrpc` — GET-binding `clef(...)` вместо iframe-страницы.
- [x] **src: OpenRPC params by-name + авто-теги** (2026-11-21, выбор пользователя): `openrpc()` раскладывает
      object-вход на дескриптор per property (by-name: clef шлёт карту имён — ровно то, что ждёт сервер;
      прежний один 'params'-дескриптор давал `{params: value}` → -32602 в Try it). Пустая схема (void/any)
      → `params: []`; скаляр → один 'params'-дескриптор (Try it скаляры не исполняет: стандартными
      by-name/by-position params скаляр не выражается). Дефолт-тег = имя класса в openapi/openrpc
      (явные `tags` перебивают) — группировка методов в clef/swagger.
- [x] **src:** слой `tools/` — `agentTools(composer)` (отдельная функция, не метод ядра): готовые тулы
      для LangChain in-process (`schema`/`invoke`/`func`), общий `packToolArgs` с mcp-биндингом.
- [x] **src:** слой `format/` — `json: Format<string>`; `Format<Raw>` generic по типу провода.
- [x] **src:** MCP-биндинг `mcp(composer)` (tools/list + tools/call); артефакты-примеры: `v2-catalog.{openapi,openrpc,mcp}.json`.
- [x] **src:** MCP `initialize`-handshake (protocolVersion-негоциация, capabilities.tools, serverInfo)
      + `ping` + `notifications/initialized`. Реальный клиент теперь подключается.
      **Legacy-ревизия 2025-06-18:** в 2026-07-28 handshake/ping удалены (stateless, `_meta` в каждом
      запросе, `server/discover`). Modern-профиль — спайк 06 (`helpers/mcp`), src не тронут.
- [ ] MCP — только tools-capability: resources/prompts/sampling/list_changed/пагинация — нет.
      В ревизии 2026-07-28 sampling/roots/logging deprecated, list_changed → `subscriptions/listen`.
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

**Пересортировка (2026-11-19, решение пользователя):** MCP-SSE поднят в очереди на **06** — следующий
спайк в работе сразу за согласованными 01–05. Бывшие 06 stream → **07**, 07 capnweb → **08**;
09/10/11 не двигались. **11 group-stream — под вопросом** (форма 3b выбрана, но перенос не одобрен).

**В src (примеры 01–05, 07, 09–10; 01–05 согласованы пользователем 2026-11-18, подтверждено 2026-11-19):**
- 01 rpc, 02 rest — базовые декларации (fn / get-post) + биндинги + транспорт, default json;
  docs — отдельные GET-binding'и (openapi/swagger/redoc), не внутри rest.
- 03 мультипротокол — один compose → rest/jsonrpc/mcp + agentTools (один реестр).
- 04 форматы — **значение-уровневый шов + format-ручка generic-адаптера (перенесено в src)**:
  json → devalue/msgpack сменой кодека (протокол один, без матрицы протокол×формат), formdata
  read-режим, раннее извлечение тела (format только encode ответа), docs raw-escape. Причинность:
  тело приходит сырым, парсит адаптер на границе (не клиент/handler).
- 05 websocket — **WS через message-шов в src** (перенос 2026-11-18): fromWs поверх jsonrpc.message,
  фреймы/notification/batch + format-ручка (default json и кастомный msgpack). HTTP-демо убрано
  (SvelteKit/Request не про сокеты, WS идёт через message). `helpers/message` — демо-LoopbackSocket.
  Прогнан: call→5, notification→0 фреймов, batch→массив, msgpack-фрейм→5.
- 07 stream — **третий глагол в src** (перенос 2026-11-18): stream({in,event}) + compose.stream,
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
- 06 mcp-sse + `helpers/{mcp,http,mcp-client}` — **MCP Streamable HTTP ревизии 2026-07-28**
  (переписан 2026-11-19, форма на согласование; целевая ревизия выбрана пользователем).
  Прежняя форма спайка (сессии + GET-подписка + DELETE) **устарела по спеке**: ревизия убрала
  протокольные сессии и `Mcp-Session-Id` (SEP-2567), `initialize`/`notifications/initialized`/`ping`
  (SEP-2575), GET-эндпоинт и `resources/subscribe` (заменены `subscriptions/listen`), resumability
  (`Last-Event-ID`, id событий) и серверные JSON-RPC-запросы (вместо них MRTR, SEP-2322).
  **Форма поверхности (задал пользователь 2026-11-19): у пользователя только обёртка.**
  `const mcpEndpoint = mcp(composer, {…})` + `export const POST = fromSvelteKit(mcpEndpoint)`;
  в доменном коде — `mcpEndpoint.publish({ kind: 'tools-changed' })`. Одна фабрика вместо двух
  (`mcpModern` + `mcpStreamableHttp` удалены как superseded) и **generic** адаптер вместо
  MCP-специфичного транспорта. Блок [1] примера — **7 строк кода**; grep подтверждает: ни
  `notifications/*`, ни `io.modelcontextprotocol/*`, ни имён заголовков, ни `_meta`/`resultType`/
  `subscriptionId`, ни `signal`/`AsyncIterable`/генераторов.
  **Проекция `reply` ОТОЗВАНА — четвёртая модель не нужна.** Поток едет в `body` существующего
  http-шва: `TransportResponse.body` уже `unknown`, поэтому `AsyncIterable` проходит без изменения
  типа, а SSE-фрейминг — работа адаптера. MCP отдаёт `{ http }`, как rest/jsonrpc. Зафиксированный
  словарь проекций http/message/stream остаётся нетронутым.
  **Дельта к src (аддитивна, старые биндинги и адаптеры не ломаются):**
  | Куда | Что |
  |---|---|
  | `types.ts` | `TransportRequest += headers?, signal?` — оба необязательны → rest/jsonrpc/mcp/capnweb совместимы по типам |
  | `transport/` | `fromSvelteKit(protocol, opts?) → handler` (каррирование, как `fromWs`); старая per-call форма сохранена перегрузкой → примеры 01–05/09 не ломаются. SSE-фрейминг, если `body` — AsyncIterable: keep-alive, `X-Accel-Buffering: no`, pull-backpressure, финальный ответ закрывает поток. `body == null` → тела нет (202/204) |
  | `protocol/jsonrpc/mcp.ts` | modern-профиль + канал подписчиков (замена legacy 2025-06-18) |
  | фасад `.` | `McpChange`, `McpEndpoint` (`publish`/`close`) |
  Src не тронут: legacy `mcp()` (2025-06-18) продолжает обслуживать примеры 03/09.
  **Канал вместо генератора (push, а не pull).** Пользователь не пишет async-генератор, `signal`
  и cancellable-паузы — он зовёт `publish(change)` из домена. Очередь на подписку, fan-out,
  регистрация/снятие и **ожидание по signal живут внутри библиотеки**, поэтому отмена prompt
  без кооперации пользователя. Один подписчик = один drain-цикл (один слот wake корректен;
  в прежнем session-спайке очередь будила только последнего читателя — второй голодал).
  `close()` завершает все подписки gracefully (финальный ответ, затем закрытие).
  События доменные (`{kind:'tools-changed'}`, `{kind:'resource-updated', uri}`), не wire-строки;
  флаг `resources: true` вместо ключей фильтра спеки; capabilities честные (`tools:{}` всегда,
  `resources:{}` только по флагу). Под капотом профиля: `_meta`/`io.modelcontextprotocol/*`,
  `resultType`, `server/discover`, `tools/list`+`tools/call`, CacheableResult,
  `subscriptions/listen` (ack первым, agreed-subset, MUST NOT-фильтр, `subscriptionId` = id
  запроса, graceful-финал), таблица `WIRE`, POST-only/405, Origin/403, сверка заголовков +
  base64-сентинел → 400/-32020, 202, -32022 + `data.supported`, -32602 на отсутствующий `_meta`,
  404/-32601 на неизвестный метод, подсказка legacy-клиенту.
  **Измерено (временные прогоны, удалены).**
  - keep-alive не теряет кадры: 8 комментариев + ack + 2 события за 300ms тишины.
  - Отмена async-генератора на `await` **отложена, не потеряна** (cleanup доезжает, когда
    завершается текущий await). Прежний вывод «нужен signal-aware `wait` у пользователя»
    **уточнён**: `reader.cancel()` висел потому, что САМ транспорт await'ил `it.return()`
    в алгоритме cancel. Изолированный замер на некооперативном источнике:
    `return iter.return()` → **51ms**, `void iter.return()` → **0ms**, cleanup выполнен
    в обоих случаях (~51ms). Спека требует стоп работы и не слать сообщений, но не требует
    блокировать cancel на чужом finally.
  - Проверки `if (signal.aborted) return` в генераторе пользователя избыточны: профиль
    проверяет signal сам — источник без проверок после abort сразу отдаёт `done`.
  - В новой форме cancel в примере — **0ms**, пользовательского signal нет вовсе.
  Прогнан (14 проверок): discover→2026-07-28/complete/serverInfo, tools/list→ttlMs+cacheScope,
  tools/call→42 complete, notification→202 с пустым телом, listen→ack+3 tagged-события+
  graceful-финал, узкий фильтр→resources/updated не доставлен, cancel→0ms,
  header mismatch→400/-32020, bad version→400/-32022+supported, missing _meta→400/-32602,
  unknown→404/-32601, GET/DELETE→405/405, bad origin→403, legacy initialize→404+подсказка.
  Все 11 примеров прогнаны, src — 62/62 теста, `tsc --strict` по примерам — 0 ошибок.
  Пример 06 разрезан на три части: [1] код пользователя (7 строк), [2] карта «под капотом»
  с дельтой к src, [3] демо-клиент и проверки (стенд `helpers/mcp-client`, **не API пакета** —
  клиентский рантайм chord остаётся отдельным слоем). `helpers/{mcp-modern,mcp-transport}`
  удалены как superseded (восстановимы из git).
  **Открыто:** MRTR (`input_required`/`inputRequests`/`inputResponses`) не реализован; request-scoped
  `notifications/progress` на `tools/call` (нужен источник progress из обработчика); backpressure
  канала — очередь на подписку пока не ограничена (пересечение со спайком 11: reliable/lossy);
  полная сверка `Mcp-Param-*` с телом требует `x-mcp-header` из `inputSchema` (сейчас проверяется
  только кодировка); `resources/list`/`resources/read` и prompts RPC не реализованы (флаг
  `resources` заявляет capability и подписки, но не сами методы); MissingRequiredClientCapability
  `-32021`; dual-era (legacy+modern на одном эндпоинте) — спека разрешает MAY, не делали;
  `message`-проекция у modern-профиля не построена (WS/stdio MCP — отдельный шаг); перенос в src
  = дельта выше + reuse `toError` семейства (в спайке маппер свой).
- 08 capnweb + `helpers/capnweb` — capnweb-**клиент** `connect<S>` (pipelining, capabilities по ссылке);
  серверный биндинг уже в src. Прогнан: pipelining, capability-стаб, цепочка одним round trip.
- 11 group-stream + `helpers/group-stream` — **group/broadcast-стрим, вариант 3b** (форма выбрана
  пользователем 2026-11-18 после сравнения 1/2/3a/3b; **под вопросом** 2026-11-19, перенос в src
  не одобрен). Декларация
  `stream({ in, event, group, backpressure })` с типизированными хэндлами `Board.$events.publish(room, e)`
  / `Board.$events.subscribe(room, signal)` (без magic strings, типы из схемы). Общий генератор на
  группу (дедуп по ключу, сигнатура `(input, signal)` прежняя) тапает subscribe-хэндл и деривирует
  события; канал ядра держит fan-out / refcount / per-subscriber backpressure (reliable буфер+disconnect,
  lossy drop). Связь applyUpdate→events — явный publish. CRDT-доска. Прогнан: два подписчика комнаты
  (fan-out), накопление снапшота, отмена одного→другой продолжает (refcount), отдельная комната,
  reliable-overflow→disconnect. Транспорт подписки — тот же stream-шов (fromWsStream/SSE не меняются).
  Открыто: мультиплексирование calls+подписок по id на одном сокете, типизированный клиент.

## Gap-ревью перед переносом в src (приоритеты)

- **Разблокировать заголовок v2:** stream — закрыт (глагол + проекция в src, 2026-11-18);
      клиентский рантайм — остался. Серверная часть транспортной ставки закрыта полностью.
- **Правдивость заявлений:** MCP `initialize` — закрыт для legacy 2025-06-18 (handshake в src),
      но целевая ревизия 2026-07-28 handshake убрала: modern-форма живёт в спайке 06, перенос не
      одобрен. Авто-refcount capability-реестра capnweb — нет (ручные `release`/`dispose` есть;
      сессия без dispose течёт).
- **Тихие продакшен-риски:** DI через `paramNames(fn.toString())` молча ломается при минификации
      бандла потребителя (нужен unbuilt `.ts`/jiti или явные ключи inject); класс без конструктора —
      баг исправлен (`paramNames` ищет `constructor(`); ctx есть в `invoke(args, ctx)`, но func-обёртка
      LangChain его не несёт («от чьего имени агент»).
- **Порядок:** дизайн-доки сведены со спайками, карта exports зафиксирована (v2-architecture.md),
      серверная вертикаль в src (проекции + адаптеры + stream, 2026-11-18). Осталось: client, затем release-шаг.
- **Безопасность:** docs — явные binding'и, которые пользователь монтирует сам (экспозиция под его
      контролем, не «публичны по умолчанию»); нет `securitySchemes`/auth-истории, MCP-аннотации —
      подсказки не enforcement, capability без lifetime/scope.

## Тесты

- [x] **Ко-локация в src по слоям** (62 теста, 2026-11-18): `core/{core,register,stream}.test`,
      `schemas/{schemas,validators}.test`, `generate/generate.test`, `tools/tools.test`,
      `protocol/{jsonrpc,protocol,capnweb,events}.test`, `transport/transport.test`.
      Общий helper — `src/test-utils.ts` (envelope). vitest include `src/**/*.test.ts`; `tsconfig.build.json`
      исключает тесты из dts-emit. typecheck (`tsc --noEmit`) покрывает и тесты.
- [x] Примеры `design/examples/` (01→11, общие классы `shared.ts`) — compile-checked против src, прогнаны живьём.
- [x] **MCP conformance: официальный рефери + fixture-контракт апстрима** (2026-11-19,
      `src/protocol/mcp/tests/` — ко-локация с модулем, решение пользователя).
      `@modelcontextprotocol/conformance@0.2.0-alpha.12` (MIT, точный пин — тот же, что у апстрима
      `modelcontextprotocol/typescript-sdk`, `test/conformance`). Рефери ходит по HTTP как настоящий
      клиент, чёрный ящик, без привязки к API SDK. Набор заморожен ревизией:
      `conformance server --requirements 2026-07-28` → 50 сценариев запущено, 37 scored,
      13 extension/pending не оцениваются. `pnpm test:mcp` (ratchet) / `pnpm test:mcp:report` (отчёт).
      `harness.ts` поднимает endpoint на 127.0.0.1:random и мостит node:http ↔ fetch
      Request/Response со стримингом SSE; под тестом спайк `design/examples/helpers/{mcp,http}` —
      после переноса в `src/protocol/mcp` меняются импорты harness, сценарии/baseline не трогаются.
      `@types/node` добавлен в devDeps (harness использует node:http, тесты теперь внутри src и
      попадают в typecheck); `tsconfig.build.json` exclude += `src/**/tests/**` — проверено,
      в dts-emit попадает только `protocol/mcp/index.d.ts`.
      **Fixture-контракт склонирован** (`fixtures.ts`): клонирован КОНТРАКТ, а не код апстримного
      `everythingServer.ts` (1659 строк под API SDK; пин коммита
      `5ee54ee30ddc00a914a3d981880f87fdce0e6246`). Имена/схемы/поведение выражены через `fn` + meta,
      чтобы шли валидация, DI и реестр chord. Имена тулов в MCP плоские (`test_image_content`),
      реестр адресует `Service.method` → имя через `mcp.name`, профиль строит индекс.
      Resources/prompts различаются meta `mcp.resource`/`mcp.prompt` и в tools/list не попадают.
      **Ядро не менялось**: `fn<C extends Contract>` пропускает meta в реестр. Объём — scored-набор
      2026-07-28; legacy-тулы прежних ревизий и tasks-расширение не клонированы (не скорятся).
      Профиль расширен: passthrough CallToolResult (content-блоки image/audio/resource/mixed),
      resources/list + read + templates/list, prompts/list + get, completion/complete,
      CacheableResult на read (не только list), SEP-2164 → -32602 + data.uri.
      **Baseline:** `expected-failures.yaml`, 14 записей, формат апстрима. Рефери падает
      и на unexpected failure (регрессия), и на **stale entry** (сценарий из списка начал проходить →
      убери строку). Проверено вживую: добавление проходящего `tools-call-simple-text` → «Stale
      baseline entries» + exit 1. Подвох: pretty-сводка печатает ✓ для сценариев с WARNING
      (SHOULD-проверки), но reconciliation считает их непрохождением — они обязаны быть в baseline
      (на этом споткнулись: снятие двух таких строк по сводке сделало прогон красным).
      **Динамика:** до fixture-контракта 106 passed / 62 failed и 6 чистых scored-сценариев →
      после **127 passed / 44 failed, 23 из 37 scored проходят**. Закрыты: tools-list,
      контент-тулы (image/audio/embedded/mixed), completion-complete, resources-list/read-text/
      read-binary/templates-read, prompts-list и все prompts-get-*, caching, sep-2164.
      `http-header-validation` — 14/14, `server-stateless` — 26/28 включая wire-schema-valid:
      независимое подтверждение формы (POST-only, заголовки, Origin, SSE, stateless).
      **Осталось (корневые причины):** (1) MRTR SEP-2322 — 12 сценариев (`input_required`,
      `inputRequests`, `requestState`, multi-round, tampered-state, capability gating);
      (2) `-32021` MissingRequiredClientCapability — 2 проверки server-stateless;
      (3) request-scoped `notifications/progress` — канал есть, привязки к запросу нет.
      Не scored: tasks-* (SEP-2663), json-schema-2020-12 (нужен hand-authored JSON Schema —
      zod такие ключевые слова не эмитит), http-custom-header-server-validation (SEP-2243
      x-mcp-header, ни один тул не аннотирован). Лицензии: MCP в переходе MIT → Apache-2.0
      (доки CC-BY-4.0), рефери MIT, chord Apache-2.0 — совместимо; attribution и пин коммита сохранены.
- [ ] Продвинутые спайки `examples/helpers/{mcp,http,mcp-client,capnweb,group-stream}`
      (06/08/11) — compile-checked + ручной прогон; MCP-часть покрыта официальным рефери
      (`src/protocol/mcp/tests`), своих vitest-тестов на профиль/канал пока нет. `mcp-client` —
      демо-стенд, не публичный API и не клиентский рантайм пакета; `http` — предлагаемая версия
      generic-адаптера.
- [ ] v1 `batch`/`spec` — падают (6 тестов, pre-existing; проверено на чистом src 2026-11-18), не чинил.

## Главная ставка / риски

- Ставка не изменилась: одна схема → типы + рантайм-валидация + JSON Schema → OpenRPC/OpenAPI/MCP/тулы.
  Фундамент (регистрация + валидация + call/notify/stream) готов; генерация, протоколы-проекции,
  транспорт и **клиент в src** (2026-11-20). Release-конфиг собран, гейты зелёные (см. раздел релиза).
- v1-фасад закрыт: `@deprecated`, `exports`, `publint`/`attw` — сделано (2026-11-20).
- Самые большие незакрытые куски — MCP modern-профиль (перенос спайка 06) + resources/prompts/sampling;
  авто-refcount capnweb, минификация DI и ctx func-тулов (тихие риски); клиентские notify/batch/stream;
  stream-довески: backpressure, мультиплексирование подписок, middleware вокруг stream, generic SSE.

## Не проверял

- Реальный MCP-handshake живым клиентом, WS/SSE вживую, браузерный рендер docs.
- Влияние минификации на DI (`paramNames`) и на клиентские proxy-имена методов (property mangling).
- `pnpm build`/`publint`/`attw` прогнаны 2026-11-20 (зелёные); terser-минификация v1 — не гонялась.