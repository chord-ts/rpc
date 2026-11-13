# Pipeline выполнения запроса — переработка (v2)

> Инсайт автора: текущий пайп запроса громоздкий — куча проверок и try/catch с непокрытыми
> кейсами, потому что в одном месте смешаны middleware разных уровней и неявные мутации.
> Ниже — разбор и целевая модель.

## Что сейчас сломано

Пайп держит четыре разных механизма в одном месте:

1. **`initCtx` угадывает форму raw-события** цепочкой `if` («уже JSON-RPC? есть `.body`?
   есть `.json()`? есть `.request`?»). Это транспортное знание, которого у ядра быть не должно,
   и именно оно порождает непокрытые ветки.
2. **`adapter` — мидлварь с неявной мутацией** (`ctx.body = …`), а не чистая граница
   «событие → тело».
3. **Два уровня middleware** (composer + per-method `use`) плюс неявная конвенция «раннего
   возврата `Response`/`Error`» — всё это в `runMiddlewares` с мутирующими `index`/`error`.
4. **DI через `createScoped`/`depends`**: `Proxy` подменяет `this`, контекст подмешивается магией.
5. **Ошибки**: catch-all режет всё до `InternalError` + `data:[e]`, 3xx-редиректы выталкиваются
   ad-hoc проверкой `e.status.startsWith('3')`.

Общий корень — нет разделения **границы (парсинг)** и **ядра (диспатч)**, и три механизма вместо
одного контракта.

## Целевая модель: `exec(body, ctx)`

Ядро принимает уже распарсенное, типизированное тело и контекст, не зная про транспорт:

```ts
composer.exec(
  body: JSONRPC.Request | JSONRPC.Batch,
  opts?: { ctx?: unknown }
): Promise<JSONRPC.Response | JSONRPC.BatchResponse>
```

Пайп внутри — линейный:

```
body (Request | Batch)
  → нормализовать в список вызовов
  → по каждому: route (method → desc)
  → один middleware-контракт (чистый, единственный early-return тип)
  → validate(in) → invoke → validate(out)
  → типизированный результат
```

## Где живёт парсинг

**Одно-endpoint JSON-RPC** — парсинг у пользователя в эндпоинте, одна строка:

```ts
const body = await event.request.json();
return json(await composer.exec(body, { ctx: event.locals }));
```

**Multiendpoint / SSE / WS** — та же граница, но как подключаемая функция
`parse(event) => { body, ctx }`. Ядро `exec(body, ctx)` не меняется, сколько бы эндпоинтов ни
пришло.

«Для jsonrpc делегировать парсинг сработает, для multiendpoint нет» верно только против текущего
«угадай сам». Если граница — подключаемый адаптер, а не ветки в ядре, оба случая покрываются одной
моделью: ядро всегда ест `(body, ctx)`, а эту пару готовят либо пользователь, либо адаптер транспорта.

Из коробки остаются тонкие сахарные `fromSvelteKit(event)` / `fromExpress(req)` — helpers поверх
`exec`, не отдельный механизм.

## Что убивает эта модель

- `initCtx` исчезает целиком — угадывания больше нет.
- `adapter`-мидлварь превращается в pure `parse`.
- `depends` и `createScoped`-Proxy уходят — их закрывает constructor DI из проекта регистрации.
- catch-all ошибок заменяется типизированным результатом и явным маппингом (redirect/validation/internal —
  три раздельных исхода, а не один `InternalError` с «не покрытым» остальным).

## Middleware-контракт: onion с одним Result

Выбор — onion `(ctx, next) => Result`, а не чистый `ctx => ctx`. Причина: чистому преобразованию
недоступна работа «после» (`next` вернул результат — закэшировать, залогировать, переписать).
Кэш, тайминг и маппинг ответа требуют «после», значит нужен `next`.

Но это ровно один механизм вместо трёх нынешних:

```ts
// 1. Граница отдаёт уже распарсенное тело + стартовый контекст.
interface ExecInput<Ctx = BaseContext> {
  body: JSONRPC.Request | JSONRPC.Batch;
  ctx: Ctx;
}

// 2. Единый результат без исключений.
type ErrorObject = { code: number; message: string; data?: unknown; status?: number };
type Result<T = JSONRPC.Value> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorObject };

// 3. Единственный middleware-контракт.
//    Терминальный next() = сконструировать сервис с текущим ctx и вызвать метод
//    (validate(in) → invoke → validate(out)).
type Middleware<Ctx> = (ctx: Ctx, next: (ctx: Ctx) => Promise<Result>) => Promise<Result>;
```

Что это убивает:

- `event` из контракта исчезает — парсинг ушёл на границу, ядро видит только `ctx`.
- `adapter` превращается в pure `parse(event) => { body, ctx }` (сахар `fromSvelteKit`/`fromExpress`).
- `depends`/`createScoped`-Proxy уходят: сервис инстанцируется в терминале как `new Service(ctx)`.
- «ранний возврат» — это просто middleware, вернувший `Result` без вызова `next`; отдельной
  конвенции больше нет.

### Мутация ctx — одна и явная

`ctx` — объект, который middleware обогащают (`ctx.user = …`). Это единственная мутация во всём
пайпе, она документирована, а не размазана по трём механизмам, как сейчас. Тип задаёт пользователь
параметром `Composer<Ctx>`; поля, которые добавляют middleware, описываются этим интерфейсом.
Послойный вывод `ContextOf<Middlewares>` — возможен, но в v2.1, ради простоты не тянем.

### Цепочка без мутабельного индекса

Текущий `runMiddlewares` держит `index`/`error` в замыкании — это источник «не покрытых» кейсов.
Композиция через рекурсию чище:

```ts
function runChain<Ctx>(
  ctx: Ctx,
  middlewares: Middleware<Ctx>[],
  terminal: (ctx: Ctx) => Promise<Result>
): Promise<Result> {
  const dispatch = (i: number) => (c: Ctx): Promise<Result> =>
    i < middlewares.length ? middlewares[i](c, dispatch(i + 1)) : terminal(c);
  return dispatch(0)(ctx);
}
```

Терминал — единственное место вызова метода:

```ts
function dispatch(call, ctx): Promise<Result> {
  const desc = route(call.method);           // method → { service, method, schema }
  if (!desc) return { ok: false, error: { code: MethodNotFound, message: … } };
  const terminal = (c) => invoke(desc, call.params, c); // new Service(c); validate; method; validate
  return runChain(ctx, [...composer.middlewares, ...desc.use], terminal);
}
```

## Конверт результата (single / batch)

JSON-RPC 2.0 уже задаёт корреляцию по `id`: запрос с `id` получает ответ, а **notification** (без
`id`) — не получает ничего. Текущий код это ломает: `batch.map((r, i) => … calls[i])` дрейфует по
индексу, как только в пачке есть notification.

Поэтому конверт ключуется по `id`, а не по индексу, и делается двумя симметричными границами.

Серверная (`Result[]` → wire):

```ts
type Call = { id: ID | null; method: string; params: unknown[] | object };

function normalize(body: JSONRPC.Request | JSONRPC.Batch): Call[];  // Request -> [call]; Batch -> calls

async function exec(input: ExecInput): Promise<WireResult | WireResult[]> {
  const out: WireResult[] = [];
  for (const call of normalize(input.body)) {
    const r = await dispatch(call, input.ctx);
    if (call.id != null) out.push(toWire(r, call.id)); // notification не порождает ответ
  }
  return Array.isArray(input.body) ? out : out[0];
}
```

Клиентская (wire → `Result[]`, без потерь):

```ts
function batch(...calls): Promise<Result[]> {
  const wire = await transport({ body: calls, … });
  // Собираем ответы по id, ошибки не выбрасываем: каждый элемент —
  // { ok: true, value } | { ok: false, error }, коррелированный с исходным запросом.
}
```

Итог: на клиенте больше нет `res.map(r => r.result)` с молча потерянными ошибками — каждый элемент
пачки несёт явный статус, привязанный по id.

## Закреплённые решения (middleware/конверт)

- Доступ к результату «после» нужен (закэшировать/подменить) — и onion `(ctx, next) => Result`
  уже даёт его нативно: middleware вызывает `next(ctx)`, берёт `Result` и возвращает заменённый или
  закэшированный. Отдельного жизненного этапа `.output` не заводим.
- Форму `JSONRPC.Error` не специфицируем сверх `{ code, message, data?, status? }`; маппинг в
  `buildResponse`/`buildError` — деталь реализации, не контракт.
- Валидация фиксирована в терминале `invoke()`, валидатор один на весь `Composer`
  (schema-agnostic адаптер). Per-method подмены нет — особую проверку метод делает в своём теле.