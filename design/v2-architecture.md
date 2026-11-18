# Архитектура v2 по слоям импорта

> Компаньон к [`v2-transport.md`](./v2-transport.md) (четыре слоя) и [`PROGRESS.md`](./PROGRESS.md).
> Проектирует **модули и направление импортов** будущего фреймворка (корень `src/`, v1 изолирован
> в `src/v1/`): что из чего импортируется, где живут публичные экспорты, как не получить цикл.

## Принцип

Импорты идут **строго вниз по стеку**, ациклично. Каждый слой знает только о слоях ниже себя.
Ядро не знает ни протокола, ни транспорта, ни формата, ни генерации. Вендорные адаптеры — opt-in
листья, ядро их не импортирует никогда. Типы — общий нижний слой, их импортируют все.

Проверка инварианта: `tsc` + запрет cycle в bundler (tsdown/esbuild). Обратные рёбра допустимы
**только как `import type`** (стираются, runtime-цикла не создают) — этим уже пользуются спайки.

## Стек слоёв (снизу вверх)

```
types        сквозные контракты: AnySchema/InferOutput, SchemaAdapter, RestMeta,
             Binding, TransportRequest/Response, MessageBinding, StreamBinding + проекции
             HttpProtocol/MessageProtocol/StreamProtocol (модели взаимодействия транспорта).
             Типы слоёв — в своих слоях:
             core/types (CoreError, Contract/Fn/StreamFn, DI, Core, Client), format/types (Format),
             tools/types (AgentTool), protocol/jsonrpc/types (RPC-wire, ErrorObject).
  ↑
core         fn/stream, compose → Core (instantiate/call/notify/stream/endpoints/schemas),
             registry, dispatch/invoke, paramNames. ZERO vendor deps.
  ↑
schemas      defaultSchemas (generic ~standard), flatToolSchema, packToolArgs;
             листья: schemas/zod, schemas/valibot, schemas/yup (opt-in, peer deps)
  ↑
format       Format-реализации: json (текст), msgpack/cbor/ndjson (байт, позже)
  ↑
generate     openapi, openrpc, mcpTools, asyncapi. Читает core.schemas, не знает протоколов.
  ↑
tools        agentTools(composer): AgentTool поверх generate + schemas (не метод ядра).
  ↑
protocol     jsonrpc/ — семейство с публичным index.ts: jsonrpc-биндинг + провод
             (ErrorCode/RpcError/toError/toWire) + mcp-профиль (импортирует провод
             из соседнего jsonrpc, не пир). Пиры rest/capnweb не импортируют друг
             друга. Content-type инлайнится в ответах (shared удалён).
             Фабрики отдают проекции: rest → { http }, jsonrpc/mcp/capnweb →
             { message, http }, events → { stream }; мост messageToHttp — protocol/message.ts.
  ↑
transport    fromSvelteKit / fromExpress / fromWs / fromWsStream (+ fromNode / sse позже).
             Protocol-agnostic: потребляет проекции ({ http } / { message } / { stream }).
  ↑
client       connect (capnweb), typed jsonrpc/rest клиент, batch => per-item значение/ошибка.
  ↑
facade       корневой index.ts: публичная поверхность (реэкспорт слоёв).
```

## Что каждый слой импортирует

| Слой | Импортирует | НЕ импортирует |
|---|---|---|
| **types** | ничего (чистые типы) | всё |
| **core** | types | schemas-impl, format, generate, protocol, transport |
| **schemas** | types, core (типы); вендор-листья → свою lib | protocol, transport, generate |
| **format** | types | core-рантайм, protocol |
| **generate** | types, core (`Core`, `core.schemas`), schemas (операции) | protocol, transport |
| **tools** | generate (`mcpTools`), schemas (`flatToolSchema`/`packToolArgs`), core | protocol, transport |
| **protocol** | core (gasket), generate (docs/discovery/tools), format, schemas; mcp → jsonrpc (профиль) | transport; пиры друг друга (кроме mcp → jsonrpc) |
| **transport** | types (проекции HttpProtocol/MessageProtocol), format | protocol, core-рантайм напрямую, generate |
| **client** | types, protocol (wire-формы), transport (fetch/ws) | server-рантайм core |
| **facade** | core, tools, schemas (default), types | — (точка сборки) |

## Format и протоколы

`Format` — тупой codec-пара «текст/байты ↔ значение» (`decode/encode: unknown`), **не знает
протокола**. Протокольный биндинг решает, ЧТО за значение он отдаёт кодеку — единица провода
у протоколов разная:

| Протокол | Единица провода | Что codec'ит Format | Выбор формата |
|---|---|---|---|
| JSON-RPC | конверт `RPCRequest`/`RPCResponse` | весь конверт | negotiable (json/msgpack/cbor) |
| MCP | тот же JSON-RPC-конверт | конверт, как у JSON-RPC | фиксирован спекой = json |
| REST | **HTTP-тело** (params/resp) | только тело; статус/headers/path — протокол+транспорт | negotiable по Content-Type/Accept |
| capnweb | батч путей `{from, steps}` | структуру батча | json + спец. обработка |

- **REST**: нет RPC-конверта. HTTP-семантика (метод/path/query/статус/headers) — протокол+транспорт,
  не Format. Format codec'ит лишь payload. Один `msgpack` в JSON-RPC пакует конверт, в REST — голое тело.
- **capnweb**: capability-ссылки и pipelining (`{$cap:id}`, unresolved promises) — protocol-specific
  pre/post-сериализация поверх кодека, чистым Format не закрыть (живёт в биндинге).
- **Выбор формата**: где протокол фиксирует (MCP=json, gRPC=protobuf) — зашит; где negotiable
  (JSON-RPC/REST) — биндинг/транспорт выбирает по Content-Type/Accept (`Format.contentType`).
- **Шов transport↔protocol — значение-уровневый + format-ручка** (одобрен 2026-11-17, спайк
  `v2-value.*`; байтовый `v2-bytes.*` удалён). **Протокол один**: биндинги — те же `jsonrpc`/`rest`/
  `mcp`, переведённые на значения (`ProtocolRequest.body: unknown`), конверт/ошибки переиспользуются
  (`toWire`/`toError`), без format/raw — НЕ форки под шов/формат. **Формат — format-ручка одного
  generic-адаптера** (`fromSvelteKit(protocol, event, {format})`, default json): адаптер — сплав
  платформы и кодека (паттерн v1 `backendAdapter`), читает тело нативно (`text()`/`arrayBuffer()`/
  `formData()` по `unit`), декодирует в значение, зовёт биндинг, кодирует ответ. Пользователь втыкает
  свой кодек (devalue/msgpack/cbor) сменой кодека — **без матрицы протокол×формат**. **Format** —
  симметричный кодек значений над единицей (`unit: text/bytes`), не знает платформы/протокола.
  formdata — read-режим (`as`, multipart парсит платформа, асимметричен); docs (`text/html`,
  openapi.json) — raw-escape (`TransportResponse.raw`), мимо negotiated кодека. **Перенесено в src**
  (2026-11-17): шов значение-уровневый (`TransportRequest.body: unknown`), `Format.unit`,
  format-ручка у generic-адаптеров `fromSvelteKit`/`fromExpress` (сырое тело + раннее извлечение),
  биндинги над значениями. Реальные бинарные кодеки (msgpack/cbor) — следующий шаг.
  Для stream ndjson codec'ит каждое событие отдельно, фрейминг — транспорт (глагол в src;
  ndjson-кодек — следующий шаг).

Поэтому format ниже protocol в стеке и импортирует только types.

## Главный узел: `compose.tools()` против чистоты ядра — РЕШЕНО

Сейчас `compose` возвращает `Core` с `tools()`, а `tools()` вызывает `mcpTools` (generate) и
`flatToolSchema` (schemas). Если `compose` lives в core — **core импортирует generate**, и стек
ломается (generate сам импортирует core). В спайке это один файл, поэтому цикла нет; в модульном
src — есть.

**Решение (зафиксировано): чистый `agentTools(composer)`, ядро минимально.**

- `core.compose()` возвращает **минимальный** `Core`: `instantiate/call/notify/endpoints/schemas`.
  Никакого `tools()`, никакого импорта generate.
- `tools.agentTools(core)` — **отдельная функция** слоя tools (generate + schemas), не метод ядра.
- Пользователь вызывает `agentTools(composer)` явно. `composer.tools()` из спайка убирается.

Ядро максимально чистое: не знает ни генерации, ни тулов. Цена — пользователь теряет
`composer.tools()` и импортирует `agentTools` отдельно; это осознанный размен на чистоту слоёв.

## Протокол-согласованность класса и роутинг

**Класс сервиса протокол-согласован:** либо REST (`get/post`, `contract.rest`), либо RPC
(`fn/stream`). Смешивать стили в одном классе нельзя — `compose`/`buildRoutes` бросает
`[chord] X: mixes REST (get/post) and RPC (fn/stream) declarations in one class…`. REST и RPC разносятся по разным
сервисам (`Catalog` + `Math`); simple-эндпоинты без `$method` не считаются.

**Composer не решает REST vs RPC.** Ядро — протокол-агностичный плоский реестр
`Service.method → handler` и один gasket `call(method, params, ctx)`. Решение об адресации
принимает **протокол** (фабрики отдают проекции, адаптер берёт свою):

```
HTTP-запрос → транспорт (fromSvelteKit) → ПРОЕКЦИЯ ПРОТОКОЛА (адресация) → composer.call(method, params)
```

- **rest-биндинг** — адресация по **пути + HTTP-глаголу**: строит маршруты только из эндпоинтов
  с `rest`-метаданными (`GET /items/{item_id} → Catalog.getItem`), пакует срезы `{path,query,body}`.
  RPC-эндпоинт без rest-метаданных по пути не вызывается.
- **jsonrpc/mcp-биндинг** — адресация по **имени** из конверта (`{method:'Math.count'}`);
  роутинг по пути не нужен. REST-эндпоинт тоже можно вызвать по имени (params — срезы).

Разделение классов — ограничение **декларации** (чистая организация + транзитивные доки:
REST-класс → OpenAPI, RPC-класс → OpenRPC/MCP, без частичного попадания класса в оба документа).
В рантайме биндинги агрегируют поверх всех классов одного composer; какой эндпоинт доступен
по пути, а какой по имени — определяется наличием `rest`-метаданных, а не классом как таковым.

## Binding на уровне адаптера — проекции протоколов (перенесено в src 2026-11-18)

**Разворот зависимостей:** не адаптер подстраивается под форму протокола, а протокол сам отдаёт
адаптеру нужный контракт. Биндинг — **модель взаимодействия транспорта** (транспорт-адресуемый
http / самоадресуемый message / поток stream), а не контракт на протокол; словарь мал и растёт
аддитивно (спайк 10: stream-модель добавлена новыми файлами, старые не тронуты).

- Контракты — в types.ts: `Binding` (http), `MessageBinding` (value → value|null), проекции
  `HttpProtocol { http }`, `MessageProtocol extends HttpProtocol { message }`.
- Фабрики: `rest → { http }`; `jsonrpc/mcp → { message, http }`; capnweb `ServerSession` +
  message/http. Мост `messageToHttp` (protocol/message.ts) встроен в фабрику — пользователь
  не пишет кастомный binding: `fromSvelteKit(jsonrpc(composer))` как `fromSvelteKit(rest(composer))`.
- Адаптеры стабильны и протокол-агностичны: fromSvelteKit/fromExpress требуют `{ http }`,
  fromWs — `{ message }`. Пересечение моделей enforced типами (REST × WS — ошибка типов);
  проекции — обычные поля, способности композируются spread'ом, кастомный транспорт берёт
  контракт напрямую (`rpc.message.handle`).
- Транспорт больше не импортирует protocol — только types (проекции) + format.

**ЗАФИКСИРОВАНО (2026-11-18): базовая форма утверждена. Правки утверждённого — только с
обоснованием, доказательством и альтернативами, не втихую.** Единый глагол `handle` на всех швах,
модель задаёт сигнатуру; именованные проекции — ключ диспетчеризации (адаптер не знает протокол);
композиция способностей — spread полей.

**Семантика раннего извлечения (тело распарсено пользователем) — зафиксирована:**
- значение на руках, HTTP-семантика не нужна → `protocol.message.handle(value)` — нативный шов,
  без dummy method/url (null = notification). Канонический пример — `examples/04-formats.ts`.
- нужен HTTP-ответ, а тело в кастомном формате / уже распарсено платформой → адаптер с `opts.body`
  (`fromSvelteKit(p, event, { body })`): decode пропускается, format только encode ответа,
  адаптер сам берёт http-проекцию (статусы/headers). Без кастомного формата opts.body не нужен —
  адаптер декодирует штатно.
- REST → всегда http-проекция (method+path — его адресация; message-проекции нет).
Оси ортогональны: «кто декодирует» (адаптер×Format vs пользователь) не меняет модель взаимодействия.

## Матрица протоколов и адаптеров

Протокол заявляет проекции (модели взаимодействия), адаптер требует свою. Совместимость —
пересечение, enforced типами: «—» = проекции нет, передача адаптеру — ошибка типов.
«мост» = встроенный `messageToHttp` (фабрика строит сама, пользователь не пишет).

### Протоколы × проекции

| Протокол | Где | http (`Binding`) | message (`MessageBinding`) | stream (`StreamBinding`) | Адресация |
|---|---|---|---|---|---|
| `rest` | src | ✓ нативная | — | — | транспортная: method+path+query |
| `jsonrpc` | src | ✓ мост | ✓ нативная | — | самоадресуемая: `body.method` |
| `mcp` | src | ✓ мост | ✓ нативная | — | самоадресуемая: `body.method` |
| `capnweb` | src | ✓ мост | ✓ нативная (batch→batch) | — | самоадресуемая: путь в батче |
| `events` | src | — | — | ✓ нативная | самоадресуемая подписка `{method,params}` |
| `{...rpc, ...events}` | src (композиция) | ✓ | ✓ | ✓ | композиция способностей spread'ом |

- capnweb: проекции живут на `ServerSession` (`resolve/release/dispose` сохранены).
- stream-модель в src (2026-11-18): глагол `core.stream` + `StreamBinding/StreamProtocol` +
  `events` + `fromWsStream`. Unary-генераторы (openrpc/mcpTools/agentTools) stream исключают,
  AsyncAPI строится из stream-контрактов (`contract.event`).

### Адаптеры × требуемая проекция

| Адаптер | Где | Требует | Подружится с |
|---|---|---|---|
| `fromSvelteKit` | src | `{ http }` | rest, jsonrpc, mcp, capnweb, hybrid |
| `fromExpress` | src | `{ http }` | rest, jsonrpc, mcp, capnweb, hybrid |
| `fromWs` | src | `{ message }` | jsonrpc, mcp, capnweb, hybrid; **rest — ошибка типов** |
| `fromWsStream` | src | `{ stream }` | events, hybrid; jsonrpc/rest — ошибка типов |
| `mcpStreamableHttp` | спайк 08 | `MessageBinding` напрямую | `mcp.message` (сессии + SSE — MCP-специфика) |
| `fromNode` / generic SSE | план | `{ http }` / `{ stream }` | по мере реализации |

Кастомный транспорт берёт проекцию напрямую (`rpc.message.handle(value)`, `cap.stream.handle(...)`) —
адаптеры и мост не обязательны. Format — отдельная ручка каждого адаптера (default json); матрицы
протокол×формат нет — единицы провода см. в таблице «Format и протоколы» выше.

## Карта экспорта пакета

Одна главная точка + opt-in вендорные листья. Пользователь не ходит по внутренним модулям.

Имена v2 **не пересекаются** с v1 (`fn`/`compose`/`get`/биндинги против `Composer`/`rpc`/`val`),
поэтому корень `.` переключается на v2 без versioned-сабпата, а v1 остаётся в `./v1`. Папки `v2`
в публичных путях нет — v2 и есть корень фреймворка.

```jsonc
// package.json exports — целевое состояние (корень . = v2)
{
  ".":                  "./dist/index.js",           // v2 фасад: fn/get/post/compose, биндинги,
                                                     // транспорты, generate, agentTools, defaultSchemas
  "./v1":               "./dist/v1/index.js",        // deprecated v1 facade
  "./schemas/zod":      "./dist/schemas/zod.js",     // ZodAdapter      (peer: zod)
  "./schemas/valibot":  "./dist/schemas/valibot.js",
  "./schemas/yup":      "./dist/schemas/yup.js",     // shim + адаптер
  "./client":           "./dist/client/index.js",    // стабильная точка (как в v1)
  "./core":             "./dist/core/index.js"       // минимальное ядро для embedding (опц.)
}
```

Пользовательский импорт:

```ts
import { fn, get, post, compose, rest, jsonrpc, mcp, fromSvelteKit } from '@chord-ts/rpc';
import { ZodAdapter } from '@chord-ts/rpc/schemas/zod';
import { connect } from '@chord-ts/rpc/client';
```

Биндинги/транспорты/генераторы реэкспортятся корневым фасадом `.` — гранулярные сабпаты для них
не плодим (минимум абстракций). Отдельные сабпаты только там, где есть **вес или вендор**:
schemas-листья (peer deps), client (свой рантайм), core (embedding без надстроек).

**Физическая раскладка (перенос выполнен).** v2 живёт в корне `src/`: уже перенесены `types.ts`,
`core/`, `validators/`, `index.ts`; остальные слои (`schemas/`, `format/`, `generate/`, `tools/`,
`protocol/`, `transport/`, `client/`) добавляются туда же. v1 изолирован в `src/v1/` → `dist/v1/`.
Папки `v2` нет. Сборка (tsdown) и корень `.` пока на v1 — переключение `.` на v2 и v2-entries в
tsdown это отдельный release-шаг, когда рантайм будет готов.

## Модули src (реализовано)

Superseded-спайки удалены (перенесены в src). Примеры — `design/examples/` (прогрессия 01→10,
общие классы `shared.ts`, индекс `README.md`): 01–06/09–10 на механиках src, 07/08 — спайки
(capnweb-клиент / MCP-SSE) в `examples/helpers/`.

| Модуль (корень src/) | Содержимое |
|---|---|
| `types.ts` | сквозные контракты: AnySchema/InferOutput, SchemaAdapter, RestMeta, шов (Binding/TransportRequest/Response, MessageBinding, StreamBinding) + проекции HttpProtocol/MessageProtocol/StreamProtocol — только то, что нужно несмежным слоям |
| `core/` | fn/stream, compose → Core (call/notify/stream/endpoints), registry, dispatch/invoke, paramNames; `types.ts` — CoreError, Middleware, Contract/Fn/StreamContract/StreamFn/StreamOpts, DI, Core/ComposeOptions/Endpoint, Client-проекция |
| `schemas/` | defaultSchemas, flatToolSchema, packToolArgs; лист `schemas/zod` (ZodAdapter) |
| `format/` | json (текстовый кодек); `types.ts` — Format |
| `generate/` | openapi, openrpc, mcpTools, asyncapi |
| `tools/` | agentTools (отдельно от ядра); `types.ts` — AgentTool |
| `protocol/` | `jsonrpc/` — семейство с публичным index.ts: jsonrpc (провод + ErrorCode/RpcError/toError/toWire) + mcp (профиль) + `types.ts` (RPC-wire, ErrorObject); rest (сахар get/post/http + RestContract), capnweb, events (stream); `message.ts` — мост messageToHttp. Фабрики отдают проекции: rest → { http }, jsonrpc/mcp/capnweb → { message, http }, events → { stream } |
| `transport/` | fromSvelteKit, fromExpress ({ http }), fromWs + Socket ({ message }), fromWsStream ({ stream }); format-ручка |
| `index.ts` | фасад — реэкспорт слоёв |
| **ещё нет:** `client/` | capnweb connect/RpcPromise (спайк 07), typed jsonrpc/rest клиент |
| **ещё нет:** stream-довески | backpressure, мультиплексирование подписок по id, middleware вокруг stream, generic SSE-адаптер |

## Инварианты (чем проверяем)

1. **Ацикличность runtime-импортов** — bundler cycle-check; обратные рёбра только `import type`.
2. **Ядро zero-dep** — `core/` не импортирует вендоров и надстройки; `package.json` core без deps.
3. **Вендоры — листья** — `schemas/{zod,valibot,yup}` импортируют свою lib; ядро/фасад их не тянут
   по умолчанию (иначе zod попадёт в обязательные deps).
4. **generate переиспользуем standalone** — не импортирует protocol/transport (генераторы работают
   и без сервера, для CLI/статической выгрузки).
5. **transport protocol-agnostic** — знает только проекции (HttpProtocol/MessageProtocol), не конкретный протокол.
6. **types — единственный общий слой** — никаких runtime-зависимостей, только контракты.
7. **Класс протокол-согласован** — REST или RPC, не смесь; проверяется throw'ом в `compose`
   (`buildRoutes`). Роутинг — в биндинге, composer — плоский реестр `call(method)`.

## Зафиксированные решения (2026-11-16)

1. **REST-сахар (`get/post/http`, `RestContract`) → `protocol/rest`.** `fn` — в core
   (протокол-агностичная декларация); REST-сахар — для любителей экзотики и FastAPI, живёт рядом
   с rest-биндингом. Ядро не несёт HTTP-глаголов. `RestMeta` (общий тип для generate) — в types.
2. **Чистый `agentTools(composer)`** — `tools()` убран из `Core`, отдельная функция слоя tools.
3. **Exports: корневой фасад `.` + листья** (`schemas/{zod,valibot,yup}`, `client`, `core`).
   Имена v2 не пересекаются с v1 → корень `.` переключается на v2, v1 остаётся в `./v1`. Сабпаты
   на каждый биндинг/транспорт не плодим (урок хрупких wildcard-exports v1).
4. **Format — отдельный слой** (`format/`): кодек переиспользуется protocol/transport/client.
5. **client — стабильный сабпат `./client`** (как в v1): серверный бандл не тянет клиентский
   рантайм; корневой фасад клиент не реэкспортит.
6. **Без папки `v2`** (перенос выполнен): v2 — корень `src/` (`types.ts`/`core/`/`validators/`/
   `index.ts` уже там), v1 изолирован в `src/v1/`. Публичных путей `/v2` нет; переключение корня
   `.` и tsdown-entries на v2 — release-шаг.
7. **Класс протокол-согласован** (2026-11-17): REST (`get/post`) и RPC (`fn/stream`) не смешиваются
   в одном классе — `compose` бросает ошибку. REST/RPC — разные сервисы; роутинг решает биндинг
   (rest — по пути, jsonrpc/mcp — по имени), composer — плоский реестр. Транзитивные доки без
   частичного попадания класса в оба документа.

## Не решено здесь (ждёт отдельных дизайн-сессий)

- `stream` — глагол + проекция в src (2026-11-18): `stream({in,event})`, async-генератор, один
  compose, нативные ошибки/отмена; StreamBinding/StreamProtocol, events, fromWsStream.
  Не решены: backpressure, мультиплексирование подписок по id, middleware вокруг stream
  (обёртка вокруг iterable vs per-event), generic SSE-адаптер.
- Типизированный `ctx` (`Core<Ctx>`) — проходит сквозь все слои, сейчас `unknown`.
- Минификация DI (`paramNames`) — стратегия unbuilt `.ts`/явные ключи; влияет на core.