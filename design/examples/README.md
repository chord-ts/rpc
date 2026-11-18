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
  pipelining/capabilities), `mcp-transport` (MCP Streamable HTTP: сессии + SSE),
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
| 06 | [`06-stream.ts`](./06-stream.ts) | продвинутый | stream-глагол (src): async-генератор, отмена, нативные ошибки |
| 07 | [`07-capnweb.ts`](./07-capnweb.ts) | продвинутый | Cap'n Web: pipelining, capabilities по ссылке |
| 08 | [`08-mcp-sse.ts`](./08-mcp-sse.ts) | продвинутый | MCP Streamable HTTP: GET-подписка (SSE) + POST + сессии |
| 09 | [`09-protocol-bindings.ts`](./09-protocol-bindings.ts) | продвинутый | Binding на уровне адаптера (src): проекции, мост скрыт |
| 10 | [`10-stream-projection.ts`](./10-stream-projection.ts) | продвинутый | аддитивность проекций (src): stream-модель без правок старого кода |
| 11 | [`11-group-stream.ts`](./11-group-stream.ts) | продвинутый | group/broadcast-стрим (спайк): CRDT-доска, fan-out, refcount, backpressure |

Базовые (01–02), расширенные (03–04) и продвинутые 05/06/09/10 работают на механиках из `src`
(проекции протоколов + fromSvelteKit/fromExpress/fromWs/fromWsStream, stream-глагол).
Продвинутые 07/08/11 добавляют спайки из `helpers/` (capnweb-клиент, MCP-SSE, group-stream).
**08** закрывает пробел 03: MCP требует не только POST, но и GET (SSE server→client) + сессии.
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
npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/0*.ts
```

Каждый пример — самостоятельный скрипт с демо-прогоном в конце (`console.log`).