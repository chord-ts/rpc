# Примеры chord v2 — от простого к сложному

Последовательность от базового функционала к расширенному и продвинутому, от дефолтного
поведения к кастомному. Продвинутые примеры переиспользуют базовые классы. Все примеры —
compile-checked против `src` и прогнаны живьём.

## Общие модули

- [`shared.ts`](./shared.ts) — тривиальные сервисы, переиспользуемые примерами: `Math` (fn),
  `Catalog` (REST get/post), `Echo` (echo + Date), `Ticker` (stream), `Counter` (capability).
- [`codecs.ts`](./codecs.ts) — mock-кодеки `Format` для подмены формата: `devalueMock` (текст, Date),
  `msgpackMock` (байты). Реальные devalue/msgpack/cbor — drop-in тем же контрактом.
- [`helpers/`](./helpers) — механики спайков, ещё не в src: `capnweb` (клиент
  pipelining/capabilities), `mcp` (MCP-профиль ревизии 2026-07-28 + канал подписок: одна фабрика
  `mcp(composer, opts)` → `{ http, publish, close }`), `http` (предлагаемая версия generic
  `fromSvelteKit`: каррирование, headers/signal, SSE-фрейминг потокового тела), `mcp-client`
  (**демо-клиент** MCP: конформные запросы и разбор SSE — стенд, не API пакета),
  `group-stream` (group/broadcast-стрим: канал на группу, publish/subscribe-хэндлы, backpressure);
  `message` — только демо-LoopbackSocket (message-шов, проекции и stream перенесены в src).

## Прогрессия

| # | Файл | Уровень | Что показывает |
|---|---|---|---|
| 01 | [`01-rpc-basic.ts`](./01-rpc-basic.ts) | базовый | fn → compose → jsonrpc → транспорт, default json |
| 02 | [`02-rest-basic.ts`](./02-rest-basic.ts) | базовый | get/post, resp-карта статусов, транзитивные docs |
| 03 | [`03-multiprotocol.ts`](./03-multiprotocol.ts) | расширенный | один compose → rest + jsonrpc + mcp + agentTools |
| 04 | [`04-formats.ts`](./04-formats.ts) | расширенный | format-ручка: json → devalue/msgpack, formdata, раннее тело |
| 05 | [`05-websocket.ts`](./05-websocket.ts) | продвинутый | WS через message-шов (src): фреймы, notification, batch, format-ручка |
| 06 | [`06-mcp-sse.ts`](./06-mcp-sse.ts) | продвинутый | MCP 2026-07-28: POST-only, SSE-ответ на запрос, subscriptions/listen |
| 07 | [`07-stream.ts`](./07-stream.ts) | продвинутый | stream-глагол (src): async-генератор, отмена, нативные ошибки |
| 08 | [`08-capnweb.ts`](./08-capnweb.ts) | продвинутый | Cap'n Web: pipelining, capabilities по ссылке |
| 09 | [`09-protocol-bindings.ts`](./09-protocol-bindings.ts) | продвинутый | Binding на уровне адаптера (src): проекции, мост скрыт |
| 10 | [`10-stream-projection.ts`](./10-stream-projection.ts) | продвинутый | аддитивность проекций (src): stream-модель без правок старого кода |
| 11 | [`11-group-stream.ts`](./11-group-stream.ts) | продвинутый | group/broadcast-стрим (спайк): CRDT-доска, fan-out, refcount, backpressure |
| 12 | [`12-client.ts`](./12-client.ts) | продвинутый | типизированный клиент (src/client): jsonrpc/rest конструкторы, формат-гард, wire-типы возврата |

Базовые (01–02), расширенные (03–04) и продвинутые 05/07/09/10/12 работают на механиках из `src`
(проекции протоколов + fromSvelteKit/fromExpress/fromWs/fromWsStream, stream-глагол, клиент).
Продвинутые 06/08/11 добавляют спайки из `helpers/` (MCP-SSE, capnweb-клиент, group-stream).
**06** — MCP Streamable HTTP **ревизии 2026-07-28** (спайк, форма на согласование). Ревизия
сделала MCP stateless и убрала сессии (`Mcp-Session-Id`), GET-эндпоинт, `initialize`/`ping`
и resumability (`Last-Event-ID`). Остался один POST-эндпоинт: ответ — json **или** SSE-поток,
привязанный к запросу; долгоживущие уведомления — `subscriptions/listen`, чей ответ и есть поток.
**У пользователя только обёртка** (7 строк): `mcp(composer, {…})` → `fromSvelteKit(mcpEndpoint)`;
изменения домена публикуются одной строкой `mcpEndpoint.publish({ kind: 'tools-changed' })`.
Ни генераторов, ни `signal`, ни wire-строк, ни собственного MCP-транспорта: поток едет в `body`
существующего http-шва, поэтому четвёртая проекция не нужна. Src не тронут — legacy `mcp()`
(2025-06-18) остаётся для примеров 03/09. Файл разделён на [1] код пользователя, [2] карту
«под капотом» с дельтой к src, [3] демо-клиент и проверки конформанса (стенд, не API).
**09** разворачивает зависимости: протокол сам отдаёт адаптеру нужный контракт (проекции
`{ http }` / `{ message, http }`), мост messageToHttp встроен в фабрику протокола — пользователь
не пишет кастомный binding. REST без message-проекции → WS недоступен на этапе типов.
**10** доказывает аддитивность: третья модель (stream) добавлена новыми файлами —
StreamBinding/StreamProtocol + events + fromWsStream; существующие протоколы/адаптеры не тронуты,
пересечение моделей enforced типами, способности композируются spread'ом проекций.
Перенесено в src (2026-11-18) вместе с глаголом: один compose, fn и stream рядом.
**11** — group/broadcast-стрим (вариант 3b, спайк): `stream({ in, event, group, backpressure })`
с типизированными publish/subscribe-хэндлами на декларации; общий генератор на группу деривирует
события, канал ядра держит fan-out/refcount/backpressure. CRDT-доска: два подписчика комнаты,
отмена одного (refcount), отдельная комната, reliable-overflow → disconnect. Src не тронут.

## Прогон

Типы (все примеры разом):

```bash
npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/0*.ts design/examples/1*.ts
```

Каждый пример — самостоятельный скрипт с демо-прогоном в конце (`console.log`).