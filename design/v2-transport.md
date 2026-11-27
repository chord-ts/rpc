# Транспорт, форматы и протоколы (v2)

> Пункт 3 из [`ROADMAP.md`](../ROADMAP.md) и п. 5 в [`PROGRESS.md`](./PROGRESS.md). Компаньон к
> [`v2-exec-pipeline.md`](./v2-exec-pipeline.md). Черновик: модель, протоколы, транспорты, форматы
> и варианты API-связки.

## Модель — четыре ортогональных слоя

Запрос проходит фиксированный конвейер, каждый слой отвечает за своё:

```
transport (байты)  →  format (кодек)  →  protocol (конверт)  →  ядро (dispatch)  →  protocol → format → transport
```

| Слой | Отвечает за | Примеры |
|---|---|---|
| **Ядро** | реестр `$method`, диспатч, валидация, нативные ошибки (`CoreError`) | уже есть |
| **Протокол** | конверт запроса/ответа: как выглядит «вызов метода» | JSON-RPC, REST, gRPC-web, GraphQL |
| **Транспорт** | доставка байтов, сессия, push | HTTP, WebSocket, SSE |
| **Формат** | кодирование тела | json, msgpack, cbor, ndjson, protobuf |

Слои независимы: один JSON-RPC можно гонять по HTTP (json) и по WS (msgpack); REST — по HTTP (json);
gRPC-web — по HTTP (protobuf). Ядро не знает ни протокол, ни транспорт, ни формат.

## Что уже есть (факт, не намерение)

Слои реализованы в `src/` (корень). Примеры — [`examples/`](./examples/README.md) (прогрессия 01→11).

- **Ядро** `compose(...) → Core`: протокол-агностичный gasket `call/notify/endpoints` + `schemas`.
  `call(method, params, ctx) → Promise<unknown>` (значение) — то, что нужно любому протоколу.
- **JSON-RPC-биндинг** `jsonrpc(core)`: конверт `normalize → call → toWire`, batch по id,
  notification без ответа, `rpc.discover`. Конверт живёт в биндинге, не в ядре.
- **REST/MCP/capnweb-биндинги**, транспорты `fromSvelteKit`/`fromExpress`, генераторы
  OpenAPI/OpenRPC/MCP/AsyncAPI, агентские тулы `agentTools` — см. [`v2-architecture.md`](./v2-architecture.md).
- **Ошибки нативные** (`Result` удалён): core бросает свою протокол-нейтральную
  `CoreError(kind, message, data?)` (`not-found`/`invalid-params`/`invalid-output`), ошибки
  обработчика летят как есть. JSON-RPC-модель (`ErrorCode` + `RpcError(code, data?, status?)`) —
  в `protocol/jsonrpc`; mcp импортирует её оттуда как профиль. Биндинги мапят в свой провод:
  jsonrpc/mcp — `toError` (kind → код), rest — kind → статус; `ErrorObject = { code, message, data?, status? }`
  — wire-форма, поле `status` под transport-статус.

Осталось: байтовые форматы, типизированный ctx, клиентский рантайм — см. PROGRESS.
`stream` (третий глагол + проекция) в src с 2026-11-18; SSE-ответ на HTTP-запрос — спайк 06.

## Протоколы

### JSON-RPC 2.0 — встроен

Текущий `exec`. `id` коррелирует запрос/ответ, отсутствие `id` = notification (ответ не шлётся).

### MCP — тот же JSON-RPC 2.0

MCP на проводе говорит JSON-RPC (`tools/list`, `tools/call`). Значит MCP — **не отдельный
протокол**, а JSON-RPC с фиксированным набором методов поверх того же реестра `$method`. Схемы
`in`/`out` дают JSON Schema для `tools/list`/`tools/call` бесплатно (см. п. 6 генерации).

### REST — будущий биндинг

Форма — `POST /Say.hello` (или `POST /say/hello`), body = `params`, ответ = `result` или
`{ error }` + HTTP-статус. Маппинг «method → path» и «ErrorObject.status → HTTP status» — это
конвенция протокола, а не знание ядра:

```ts
async function fromRest(composer, req) {
  const { method } = route(req);                    // путь → имя метода
  try {
    return json(await composer.call(method, req.body, { ctx: req.locals }));
  } catch (e) {
    const status =                                   // CoreError.kind → HTTP status
      e instanceof CoreError && e.kind === 'invalid-params' ? 422 : 500;
    return text(JSON.stringify({ detail: (e as Error).message }), { status });
  }
}
```

Отсюда же OpenAPI: `$method`-реестр + `~standard`-схемы → path/operation. Маппинг метод→path
искусственный (JSON-RPC методо-центричен), но REST-биндинг его фиксирует как конвенцию.

### gRPC-web / Connect — будущий биндинг

gRPC методо-центричен, поэтому мапится чище REST: `POST /package.Service/Method`, тело protobuf.
Биндинг = `call(method, params)` + protobuf-кодек сообщений. Схемы дают дескрипторы для `.proto`.
Ближе всего по духу к JSON-RPC, но требует генерации protobuf-типов — дорого, отложить.

### GraphQL — вне приоритета

Это query-язык (один endpoint, произвольная выборка), а не методо-центричный RPC. Чистое
отображение `$method` → GraphQL-схема возможно только для подмножества (мутации → методы), но
read-модель (произвольные поля/связи) — отдельная задача. Не берём в этом срезе.

### Thrift / Cap'n Proto RPC — свой IDL, не «тонкий биндинг»

Оба методо-центричны, но несут **собственный IDL + сериализацию**: Thrift — `.thrift` +
Compact/Binary, Cap'n Proto — `.capnp` + zero-copy. «Тонкий биндинг» тут не выходит — нужен
маппинг `~standard`-схемы → IDL-дескриптор (аналог `gRPC` → `.proto`). Это не транспортный
слой, а п. 6 генерации артефактов. И вербы у них шире `call`: oneway/streaming у Thrift,
capability/promise-pipelining у Cap'n Proto — значит ядру нужен `stream`, а Cap'n — ещё и
дуплекс/капабилити.

### RSocket — reactive-транспорт, а не метод-конверт

RSocket — бинарный протокол с **четырьмя моделями взаимодействия**: request/response,
fire-and-forget, request/stream, channel (двунаправленный поток). Он методо-**не**-центричен:
имя метода (RSocket-RPC) накладывается сверху. Поэтому RSocket ложится в слои
**транспорт + stream**, а не в «протокол-конверт». Его покрывает вербо-полный гasket ядра,
а не `call` в одиночку.

### Таксономия протоколов

| Протокол | Вербы | Свой IDL/сериализация | Куда ложится |
|---|---|---|---|
| JSON-RPC / MCP | call, notify | нет (json) | тонкий биндинг поверх `call`/`notify` |
| REST | call | нет (json) | тонкий биндинг + OpenAPI из схем |
| gRPC-web | call, stream | protobuf | генерация `.proto` (п.6) + `stream` |
| Thrift | call, notify, stream | Thrift IDL | генерация `.thrift` (п.6) + `stream` |
| Cap'n Proto | call, stream, capability | Cap'n Proto | генерация `.capnp` (п.6) + `stream`/капабилити |
| RSocket | call, notify, stream, channel | бинарный payload | транспорт + `stream`, метод-нейминг сверху |
| GraphQL | query | — | вне приоритета |

Вывод: четырёхслойная модель **масштабируется**, если удерживать два условия — (а) gasket ядра
**вербо-полный** (`call`/`notify`/`stream`), и (б) протоколы со своим IDL честно классифицировать
как «генерация» (п. 6), а не «транспорт/биндинг».

### Agent-протоколы: A2A, ACP, AG-UI, A2UI

Это не новый класс слоёв, а **JSON-профили и событийные схемы** поверх тех же слоёв. Они вскрывают
два уточнения модели: `stream` должен быть **событийным**, и часть этих протоколов **push-центрична**.

| Протокол | Что это | Маппинг |
|---|---|---|
| **A2A** (Google) | JSON-RPC 2.0 профиль агент↔агент (`tasks/send`, `tasks/sendSubscribe`, `tasks/get`, `tasks/cancel`) | JSON-RPC + `stream` (SSE) + Agent Card |
| **ACP** (Zed) | JSON-RPC 2.0 поверх WebSocket, агент↔редактор | JSON-RPC + WS + server→client push (`session/update`) |
| **AG-UI** | событийный стрим агент↔UI (`RUN_*`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_*`, `CUSTOM`) | событийный `stream` (SSE/WS), схема событий |
| **A2UI** (Google) | payload-формат «UI как JSON-schema» внутри AG-UI/A2A-событий | контент-формат в событиях, не слой |

Три вывода:

1. **`stream` — событийный, голые события.** Для метод-центричного RPC единица потока — значение
   (ошибки нативно, как у `call`), для agent-протоколов — типизированное **событие** по своей
   схеме (text delta, tool call, state delta, custom). Значит публичный gasket —
   `stream(method, params) => AsyncIterable<Event>`, тип `Event` задаёт биндинг, а не ядро.

2. **Push-центричность.** ACP `session/update` и AG-UI-события идут по инициативе **сервера**
   после короткого kickoff (создать сессию/run). Это покрывается именно `stream` (request/stream:
   клиент открывает подписку, сервер льёт N), а не `call`.

3. **Манифесты — это генерация (п. 6).** A2A `Agent Card` (`/.well-known/agent.json`), описания
   событий AG-UI/ACP — получаются из `$method`-реестра и `~standard`-схем, как OpenRPC/MCP, а не
   новый слой.

Все четыре — JSON без своего IDL, значит это «тонкие биндинги + генерация манифеста», а не
отдельный транспорт.

## Транспорты

Глаголы — call / notify / stream (ROADMAP п. 3):

- **HTTP** — call/notify; ответ один **или поток на запрос**. MCP 2026-07-28 (спайк 06) показал
  второй случай: POST, ответ `application/json` либо `text/event-stream`, привязанный к запросу;
  закрытие потока клиентом = отмена. Новой проекции не нужно: поток едет в `body` http-шва
  (`TransportResponse.body` уже `unknown`), SSE-фрейминг делает generic-адаптер. Ядро не меняется.
- **WebSocket** — полный дуплекс: call/notify + серверный push. Над тем же `dispatch`, но
  notification и stream — это уже не «request→response», а «frame → (не) frame».
- **SSE** — сервер → клиент (прогресс, логи, нотификации). Под stream.

Транспорт — адаптер: `parse(raw) => { body, ctx }` + способ вернуть ответ (HTTP Response / WS
фрейм / SSE событие). Никакого изменения ядра.

## Форматы

Формат — пара кодеков, применимая к конверту протокола:

```ts
interface Format {
  decode(raw: unknown): RPCBody;                                        // байты/текст → конверт
  encode(wire: RPCResponse | RPCResponse[] | undefined): unknown;       // ответ → байты/текст
}

const json: Format = { decode: (r) => r as RPCBody, encode: (w) => w };
const msgpack: Format = { decode: unpack, encode: pack };
const ndjson: Format = { decode: splitLines, encode: serializeLines };    // для stream
```

Покрываем JSON (дефолт) и MessagePack/CBOR (бинарно, компактно), NDJSON — под stream. `protobuf`
идёт только вместе с gRPC-биндингом. `searchParams`/`formData`/`binary`/encryption — это
**транспортные** форматы (как упакован запрос/ответ), а не тело RPC; их место внутри транспортного
адаптера, не в слое `Format`.

## Метаданные протокола в `fn`

Протоколу кроме схемы нужны свои поля на эндпоинте: REST — `method`/`path`, gRPC — streaming-флаги,
MCP/A2A — описание задачи, AG-UI — имя события. Схема-first ядро их не объявляет, но должно
**пропускать и отдавать** реестром.

Это уже работает из-за того, как устроен тип: `fn<C extends Contract>(c: C)` выводит полный литерал
`C` и возвращает `Fn<C> = C & { fn }`. Лишние поля проезжают в тип `typeof Say.$hello` и остаются в
рантайме (`fn` возвращает `c` как есть):

```ts
static $hello = fn({
  in: z.string(),
  out: z.string(),
  rest: { method: 'POST', path: '/say/hello' },   // доп. поле, живо в Fn<C> и в рантайме
  mcp:  { description: 'Поздороваться' },
});

// доступно биндингу: Say.$hello.rest.method → string; литералы расширяются (для сужения — as const)
```

Проверено компилятором: лишние поля не отбрасываются и не дают excess-property error; литералы
`'POST'`/`'/say/hello'` расширяются до `string` (для узкой дискриминации нужен `as const` или явный
тип). Менять ядро ради переноса полей не нужно.

Остаются два дополнения:

1. **Нейтральные поля в `Contract`** (`design/v2-registration.md`, п. 9): `description`/`summary`/
   `deprecated`/`tags`. Их одинаково читают OpenRPC, OpenAPI, MCP и A2A Agent Card.
2. **Публичный реестр** на composer: `composer.endpoints()` (или `describe()`) — readonly список
   `{ service, method, in, out, bindings }`. Каждый протокольный биндинг строит из него артефакты:

```ts
const restRouter = rest(composer);      // endpoints().rest → роутер POST /say/hello
const tools = mcp(composer);            // → { name, description, inputSchema }
const card = a2aCard(composer);         // → Agent Card
```

Один класс обслуживает несколько протоколов: `rest` и `mcp` на одном `$hello` — это два разных
артефакта из одного реестра, а не два описания эндпоинта.

## API связки — варианты

То же, что обсуждали; фиксирую вывод.

### A. Плоские `from*` + `Format` (рекомендуем)

```ts
export async function POST(event) {
  return fromSvelteKit(composer, event, msgpack);
}
app.post('/rpc', (req, res) => fromExpress(composer, req));
```

Один `composer` + разные `from*` = multi-transport. Плюс нулевая прослойка, ровно по
`v2-exec-pipeline.md` («from* — тонкие сахара над exec»).

### B. Builder на слой

```ts
const serve = transport(composer)
  .http('/rpc', { format: json })
  .ws('/rpc', { format: msgpack })
  .sse('/events', { format: ndjson })
  .build();
```

Оправдан только когда один composer держит 3+ транспортов с per-transport конфигом.

### C. Функциональный декоратор (`with*`)

```ts
const http = withHttp(composer, { format: json });
http.handle(event);
```

Каррированная A; лишняя прослойка там, где хватит функции.

### D. Proxy (заместитель)

`transport(composer)` → прозрачный объект с неявной маршрутизацией. **Отклоняем** — v2 уже
убрал `createScoped`-Proxy за неявность; на транспорте это та же магия.

## Рекомендация — порядок работ

1. **Вербо-полный gasket**: вынести `dispatch` наружу как три вербы — `call(method, params, opts?) =>
   Promise<unknown>` (значение, ошибки нативно), `notify(...) => void`, `stream(...) =>
   AsyncIterable<Event>` (+ отмена). `Event` — голое значение для метод-центричного RPC,
   типизированное событие — для agent-протоколов (AG-UI/ACP/A2A). `exec` остаётся JSON-RPC-биндингом
   поверх `call`/`notify`. Без `stream` не открыть WS/SSE/RSocket и stream-протоколы
   (Thrift/Cap'n/gRPC/AG-UI/ACP/A2A).
2. **Форматы**: `json`/`msgpack`/`cbor` (codec-пара) + `ndjson` под stream. Без нового слоя.
3. **Транспорты**: `fromSvelteKit`/`fromExpress` (сахар над `exec`), затем WS/SSE поверх `stream`.
4. **Протоколы без IDL**: REST — биндинг над `call`. Протоколы со своим IDL (gRPC/Thrift/Cap'n) —
   в п. 6 генерации, не в транспорте. RSocket — транспорт + `stream`. GraphQL — вне приоритета.
5. **Реестр + метаданные**: `composer.endpoints()` наружу; протокольные поля `fn` (`rest`/`mcp`/`a2a`)
   уже переносятся ядром — биндинги читают их и строят роуты/дескрипторы/манифесты.

## Закреплённые решения

1. Четыре слоя: ядро / протокол / транспорт / формат — независимы; ядро не знает о них.
2. Протокол-агностичный шов — публичный `call(method, params, opts?) => значение` (ошибки нативно,
   `CoreError`); `exec` — JSON-RPC.
3. MCP — JSON-RPC, не отдельный протокол; достаётся из `$method`-реестра.
4. REST и gRPC — тонкие биндинги над `call`, не подменяют ядро; GraphQL — вне приоритета.
5. Формат = пара `decode`/`encode`; transport-форматы (searchParams/formData/binary/encryption)
   остаются в транспортном адаптере.
6. Связка — плоские `from*` + `Format`; Builder — только при реальной много-транспортной связке;
   Proxy и `with*` не заводим.
7. Gasket ядра вербо-полный: `call`/`notify`/`stream`; протокол мапит свои модели на эти глаголы.
8. Протоколы без IDL (JSON-RPC/MCP/REST) — тонкие биндинги; со своим IDL (gRPC/Thrift/Cap'n Proto) —
   генерация артефактов (п. 6), а не транспортный слой; RSocket — транспорт + `stream`.
9. Agent-протоколы (A2A/ACP/AG-UI/A2UI) — JSON без IDL: A2A и ACP = JSON-RPC-профили поверх
   `stream`, AG-UI = событийный `stream`, A2UI = payload-формат UI внутри событий. Их манифесты
   (A2A Agent Card и пр.) — генерация п. 6.
10. Протокольные метаданные — доп. поля `fn`, переносятся generic-инференцией (`Fn<C>` сохраняет `C`),
    ядро их не объявляет; нейтральные поля (`description`/`summary`/`deprecated`/`tags`) — в
    `Contract`; composer отдаёт реестр `endpoints()`, биндинги строят из него роуты/дескрипторы.

## Открытые вопросы

- **stream**: форма gasket'а — `AsyncIterable<Event>` (тип `Event` — generic: голое значение для
  RPC, домённый для agent-протоколов) против callback/event-emitter; как отдаются «первые байты vs
  весь поток» (SSE/WS) и как это связано с отменой.
- **notification в WS/SSE**: id-менее вызовы — событие с именем метода? (JSON-RPC notification
   «без ответа» — HTTP-семантика, в WS это фрейм без `id`.)
- **cancellation**: id стрима + отмена (SSE close / WS frame / HTTP AbortSignal).
- **transport-статус ошибок**: `ErrorObject.status` уже есть — фиксируем маппинг по протоколам,
   или оставляем биндингу?
- **multi-endpoint**: сейчас `exec` — один endpoint; роутинг по `method` внутри. Нужен ли
   path-роутинг на уровне транспорта для REST-биндинга?
- **метаданные**: плоские поля (`rest: {...}`, `mcp: {...}`) против единого `bindings: { rest, mcp }`;
   как сузить `rest.method`/`path` без `as const` в коде пользователя.