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
types        AnySchema, Result, Contract, Fn, Client, SchemaAdapter, Endpoint, Core,
             AgentTool, Format, Binding, TransportRequest/Response, RPC-wire, RestMeta…
  ↑
core         fn, compose → Core (instantiate/call/notify/endpoints/schemas), registry,
             dispatch/invoke, paramNames. ZERO vendor deps.
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
protocol     биндинги jsonrpc / rest / mcp / capnweb. Пиры не импортируют друг друга.
  ↑
transport    fromSvelteKit / fromExpress / fromNode / ws / sse. Protocol-agnostic.
  ↑
client       connect (capnweb), typed jsonrpc/rest клиент, batch => Result[].
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
| **protocol** | core (gasket), generate (docs/discovery/tools), format, schemas | transport, другие protocol |
| **transport** | protocol (`Binding`), format, types | core-рантайм напрямую, generate |
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
- **Байтовый шов**: сейчас текстовый (`string`); бинарное тело REST / msgpack / cbor требуют
  `Uint8Array`-шов (расширение Format при добавлении кодеков). Для stream ndjson codec'ит каждое
  событие отдельно, фрейминг — транспорт (ждёт stream-gasket).

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

## Маппинг спайков → будущие модули

| Спайк (design/) | Будущий модуль (корень src/) |
|---|---|
| `v2-transport.helpers` (ядро: compose/Core/registry) | `core/` |
| `v2-transport.helpers` (REST-сахар get/post/http, RestContract) | `protocol/rest` |
| `v2-transport.helpers` (биндинги jsonrpc/rest/mcp) | `protocol/{jsonrpc,rest,mcp}` |
| `v2-transport.helpers` (fromSvelteKit/fromExpress) | `transport/` |
| `v2-transport.helpers` (Format/json) | `format/` |
| `v2-transport.helpers` (compose.tools) | `tools/` (agentTools, отдельно от ядра) |
| `v2-generate.helpers` | `generate/` |
| `v2-schemas.helpers` (SchemaAdapter/defaultSchemas/flatToolSchema) | `schemas/` |
| `v2-schemas.helpers` (ZodAdapter) | `schemas/zod` |
| `v2-capnp.helpers` (capnweb-биндинг) | `protocol/capnweb` |
| `v2-capnp.helpers` (connect/RpcPromise) | `client/capnweb` |

## Инварианты (чем проверяем)

1. **Ацикличность runtime-импортов** — bundler cycle-check; обратные рёбра только `import type`.
2. **Ядро zero-dep** — `core/` не импортирует вендоров и надстройки; `package.json` core без deps.
3. **Вендоры — листья** — `schemas/{zod,valibot,yup}` импортируют свою lib; ядро/фасад их не тянут
   по умолчанию (иначе zod попадёт в обязательные deps).
4. **generate переиспользуем standalone** — не импортирует protocol/transport (генераторы работают
   и без сервера, для CLI/статической выгрузки).
5. **transport protocol-agnostic** — знает только `Binding`, не конкретный протокол.
6. **types — единственный общий слой** — никаких runtime-зависимостей, только контракты.

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

## Не решено здесь (ждёт отдельных дизайн-сессий)

- `stream` — третий глагол core; меняет gasket и protocol/transport (SSE/WS). Слой тот же,
  но форма `AsyncIterable<Event>`/отмена не спроектированы.
- Типизированный `ctx` (`Core<Ctx>`) — проходит сквозь все слои, сейчас `unknown`.
- Минификация DI (`paramNames`) — стратегия unbuilt `.ts`/явные ключи; влияет на core.