# Migrating a server from v1 to v2

This guide walks a working v1 server over to the v2 API, one service at a time. After each step you have something you can run and check, and at the end your server is schema-first, decorator-free, and ready for REST and MCP.

The move is **non-breaking**: v1 still ships inside the package (marked `@deprecated`), the root entry re-exports it, and the old subpaths (`./middlewares`, `./validators`, `./specs`, `./client`) keep resolving. You can migrate a single service today and the rest next month — both APIs coexist in one process.

> [!NOTE]
> This guide targets `@chord-ts/rpc` **2.0.0-beta.1**, Node ≥ 20. Every "after" snippet and every wire response below was executed against this version.

## How v2 differs

v1 registers methods with decorators into a global singleton, parses the request in a middleware adapter, and returns a JSON-RPC envelope from `composer.exec(event)`.

v2 splits the same job into four layers, each with its own import:

1. **Declaration** — `fn({ in, out })` describes a method with a schema. Types, validation and docs all come from this one declaration.
2. **Registry** — `compose({ Service })` collects classes, wires dependency injection and middleware.
3. **Protocol** — `jsonrpc(composer)` or `rest(composer)` turns the registry into a protocol binding.
4. **Transport** — `fromSvelteKit(api, event)`, `fromExpress(api, req, res)` adapt a binding to a platform.

The correspondence, in one table:

| v1 | v2 |
|---|---|
| `@rpc()` on a method | `static $hello = fn({ in, out })` + a handler typed from it |
| `@val(schema)` per parameter | the `in` schema of `fn` |
| `@depends() ctx` property | constructor parameters + `inject` factories in `compose` |
| `Composer.init({ Say: new Say() })` | `compose({ Say })` — classes, not instances |
| `composer.use(sveltekitMiddleware())` | not needed — the transport adapter reads the body |
| `composer.use(auth())` | `compose({ Say }, { use: auth })` or `fn({ use: auth })` |
| `composer.exec(event)` + `json(...)` | `fromSvelteKit(jsonrpc(composer), event)` |
| `buildError({ code, message })` returns | `throw RpcError.invalidParams(...)` — factories with ready-made codes, or `new RpcError(code, ...)` for custom ones |
| `typeof composer.clientType` | `typeof jsonrpc(composer)` |
| `client<Client>({ endpoint })` | `jsonrpc<typeof api>({ endpoint })` from `@chord-ts/rpc/client` |
| `composer.getSchema(route)` | `openrpc(composer)` / `openapi(composer)` bindings, plus built-in `rpc.discover` |
| `experimentalDecorators` + `emitDecoratorMetadata` + SWC | none of it |

## Step 0. Install v2 and clean up tsconfig

```bash
npm install @chord-ts/rpc@2.0.0-beta.1 zod
# or
pnpm add @chord-ts/rpc@2.0.0-beta.1 zod
```

`zod` (v4) is an optional peer dependency. You need it if you use `ZodAdapter` for JSON Schema generation — recommended, and used throughout this guide. Validation itself works with any [Standard Schema](https://standardschema.dev/) library (see [Step 7](#step-7-replace-val-with-schemas)).

v2 derives types from schemas, not reflection. If nothing else in your project needs decorators, remove the v1 ceremony:

**`./tsconfig.json`** — delete these lines:

```json5
{
  compilerOptions: {
    // experimentalDecorators: true,   ← remove
    // emitDecoratorMetadata: true,    ← remove
  }
}
```

**`./vite.config.ts`** — the `unplugin-swc` plugin existed only to make `emitDecoratorMetadata` work under Vite. With v2 you can drop it too.

**Check:** `npx tsc --noEmit` passes without the decorator flags. Your v1 code still compiles during the transition only while the flags remain — so do this step last if you migrate incrementally, or keep the flags until the final v1 service is gone.

## Step 1. Rewrite one service schema-first

Start with the smallest service you have. Here is the running example, a greeter.

**Before (v1)** — `src/routes/rpc/+server.ts`:

```typescript
import { Composer, rpc } from '@chord-ts/rpc';
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
import { json } from '@sveltejs/kit';

class Say {
  @rpc()
  hello(name: string): string {
    return `Hello, ${name}!`;
  }
}

const composer = Composer.init({ Say: new Say() });
export type ClientType = typeof clientType
composer.use(sveltekitMiddleware());
export async function POST(event) {
  return json(await composer.exec(event));
}
```

**After (v2)** — same file:

```typescript
import { z } from 'zod';
import { compose, fn, jsonrpc, fromSvelteKit } from '@chord-ts/rpc';

class Say {
  static $hello = fn({ in: z.string(), out: z.string() });
  hello = Say.$hello(async (name) => `Hello, ${name}!`);
}

const api = jsonrpc(compose({ Say }));
export type ClientType = typeof api;
export const POST = (event) => fromSvelteKit(api, event);
```

The declaration is callable: `Say.$hello(handler)` types the handler from the schema and returns it unchanged. The annotation style does the same job — pick either, they coexist even in one class:

```typescript
class Say {
  static $hello = fn({ in: z.string(), out: z.string() });
  hello: typeof Say.$hello.fn = async (name) => `Hello, ${name}!`;
}
```

Three things happened here:

- **The declaration is a static field.** `static $hello = fn({ in, out })` describes the method; the handler is the instance field `hello` — the same name without the `$`. Calling the declaration with the handler (`hello = Say.$hello(async …)`) gives the handler its argument and return types from the schema, so a wrong signature is a compile error, not a runtime surprise. The annotation `typeof Say.$hello.fn` is the alternative form of the same contract.
- **Handlers are async.** The phantom type returns `Promise<out>`; write `async` even for synchronous bodies.
- **`compose` takes classes, not instances.** v2 constructs a fresh instance per request and injects dependencies through the constructor ([Step 4](#step-4-move-context-injection-to-the-constructor)).

> [!NOTE]
> Public prototype methods *without* a `$method` declaration are also exposed — as "simple" endpoints with no validation. Handy for internal tools, but prefer `fn` for anything a client calls. Arrow-function fields are only registered when they have a matching `$method` declaration.

**Check:** run your dev server and call the endpoint:

```bash
curl -X POST http://localhost:5173/rpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"Say.hello","params":["Ada"],"id":1}'
```

```json
{"jsonrpc":"2.0","id":1,"result":"Hello, Ada!"}
```

### How arguments travel on the wire

The shape of `in` decides both the handler signature and the JSON-RPC `params` form:

| `in` schema | Handler receives | Wire `params` |
|---|---|---|
| `z.object({ a, b })` | one object `{ a, b }` | `{"a":2,"b":3}` (by-name) |
| `z.tuple([z.string(), z.number()])` | positional args `(text, times)` | `["ab",3]` (by-position) |
| `z.string()` / `z.number()` | one scalar | `["Ada"]` — or bare `"Ada"` from the chord client |
| `z.array(z.number())` | the whole array | `[[1,2,3]]` — an array as a single value |

```typescript
class Math {
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add = Math.$add(async ({ a, b }) => a + b);

  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat = Math.$repeat(async (text, times) => text.repeat(times));

  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll = Math.$sumAll(async (nums) => nums.reduce((a, b) => a + b, 0));
}
```

All three calls below were executed against this class:

```json
{"jsonrpc":"2.0","method":"Math.add","params":{"a":2,"b":3},"id":1}      → {"jsonrpc":"2.0","id":1,"result":5}
{"jsonrpc":"2.0","method":"Math.repeat","params":["ab",3],"id":2}        → {"jsonrpc":"2.0","id":2,"result":"ababab"}
{"jsonrpc":"2.0","method":"Math.sumAll","params":[[1,2,3]],"id":3}       → {"jsonrpc":"2.0","id":3,"result":6}
```

This is JSON-RPC 2.0 §4.2 as written: `params` must be structured, a bare array is always positional. The chord client wraps a lone array argument for you (`rpc.Math.sumAll([1,2,3])` sends `[[1,2,3]]`).

### What a validation failure looks like

Send a wrong type on purpose — `Math.add` with `{"a":"x","b":3}`:

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "error": {
    "code": -32602,
    "message": "Validation error",
    "data": [
      { "expected": "number", "code": "invalid_type", "path": ["a"],
        "message": "Invalid input: expected number, received string" }
    ]
  }
}
```

`data` carries the schema library's issues verbatim, with a `path` to the offending field. An unknown method answers `-32601`:

```json
{"jsonrpc":"2.0","id":4,"error":{"code":-32601,"message":"Method not found: Say.nope"}}
```

Note the HTTP status stays `200` in both cases — JSON-RPC carries errors in the envelope, not in the status code.

## Step 2. Compose the registry and bind a protocol

The full wiring, with the options you will actually use:

```typescript
import { compose, fn, jsonrpc } from '@chord-ts/rpc';
import { ZodAdapter } from '@chord-ts/rpc/schemas/zod';

const composer = compose(
  { Say, Math },
  {
    schemas: new ZodAdapter(), // JSON Schema conversion for docs generation
    // use: [auth],            // composer-wide middleware (Step 5)
    // inject: { user: ... },  // dependency factories (Step 4)
    // validateOut: true,      // opt-in runtime check of handler output (Step 7)
  },
);

const api = jsonrpc(composer);
export type ClientType = typeof api;
```

- `compose({ Say })` with no options is valid when services have no constructor dependencies.
- The **registry key is the object key**, not the class name. v1 required `Composer.init({ Say: new Say() })` to match the class name exactly (the decorator registered under `constructor.name`). v2 never reads the class name, so minified bundles keep addressing intact.
- `jsonrpc(composer)` is the protocol binding. It handles single calls, batches and notifications, and answers the built-in `rpc.discover` method with a generated OpenRPC document — no configuration needed.

**Check:** a batch and a notification, executed:

```json
[{"jsonrpc":"2.0","method":"Math.add","params":{"a":1,"b":2},"id":1},
 {"jsonrpc":"2.0","method":"Math.add","params":{"a":3,"b":4},"id":2}]
→ [{"jsonrpc":"2.0","id":1,"result":3},{"jsonrpc":"2.0","id":2,"result":7}]
```

A request without `id` is a notification: the handler runs, and the HTTP response is `204 No Content` with an empty body.

## Step 3. Replace middleware adapters with transport adapters

In v1 the platform adapter was a middleware (`sveltekitMiddleware()`, `expressMiddleware()`) that parsed the body into `ctx`, and you returned `json(await composer.exec(event))`. In v2 the transport adapter owns the whole request/response cycle — parsing, format, status, headers.

**SvelteKit** — `src/routes/rpc/+server.ts`:

```typescript
// v1
composer.use(sveltekitMiddleware());
export const POST = (event) => json(await composer.exec(event));

// v2
export const POST = (event) => fromSvelteKit(api, event);
```

`event.locals` becomes the call context (`ctx`) that DI factories and middleware receive.

**Express:**

```typescript
// v1
import { expressMiddleware } from '@chord-ts/rpc/middlewares';
composer.use(expressMiddleware());
app.post('/rpc', async (req, res) => res.send(await composer.exec(req)));

// v2
import { fromExpress } from '@chord-ts/rpc';
app.post('/rpc', (req, res) => fromExpress(api, req, res));
```

`express.json()` upstream is fine — an already-parsed body is passed through as a value; a raw body (`express.raw()`) is decoded by the adapter. For DI on Express, attach the context as `req.ctx` in your own middleware before the route; `fromExpress` passes it to the binding.

**WebSocket — deferred.** The WS adapters (`fromWs`, `fromWsStream`, `./transport/ws`) are not
published in this revision: stream multiplexing (many subscriptions per socket) is still pending.
The code and tests live in `src/transport/ws.ts` for contributors. The client's socket mode
(`jsonrpc({ socket })` from `@chord-ts/rpc/client`) remains available against any JSON-RPC WS server.

> [!NOTE]
> Adapters are per-platform subpaths (`@chord-ts/rpc/transport/sveltekit`, `/express`) if you want to import only the platform you use. The root re-exports both for convenience.

**Check:** the curl from Step 1 still answers `{"jsonrpc":"2.0","id":1,"result":"Hello, Ada!"}` — the wire contract did not change, only who owns the transport.

## Step 4. Move context injection to the constructor

v1 injected a single `ctx` property via `@depends()`. v2 injects **constructor parameters**, keyed by name, from factories you register in `compose`. Any number of dependencies, each typed.

**Before (v1):**

```typescript
class Session {
  @depends()
  private readonly ctx!: { user: string };

  @rpc()
  whoami(): string {
    return this.ctx.user;
  }
}
```

**After (v2):**

```typescript
import { z } from 'zod';
import { compose, fn, jsonrpc } from '@chord-ts/rpc';

class Session {
  constructor(public readonly user: string) {}

  static $whoami = fn({ in: z.void(), out: z.string() });
  whoami: typeof Session.$whoami.fn = async () => this.user;
}

const api = jsonrpc(
  compose(
    { Session },
    { inject: { user: (ctx: { user: string }) => ctx.user } },
  ),
);
```

The factory key (`user`) matches the constructor parameter name. The factory receives the transport context — SvelteKit `locals`, Express `req.ctx` — and its return type must match the parameter type; `inject` is typed against your services, so a missing or mistyped factory is a compile error. A fresh instance is constructed per request, so request-scoped state is safe.

**Check:** with `locals.user = 'ada'`, `Session.whoami` answers:

```json
{"jsonrpc":"2.0","id":1,"result":"ada"}
```

### Minified bundles: the `$constructor` escape hatch

Dependency keys are parsed from `ctor.toString()`. Minifiers mangle parameter names — `constructor(user)` becomes `constructor(a)`, and the key no longer matches. `compose` detects this at startup (not on the first request) and tells you exactly what to do:

```text
[chord] Session: no inject factory for dependency "a" (from constructor parameter names).
Minifiers mangle parameter names — if this bundle is minified, add explicit keys to the class:
static $constructor = ['key1', 'key2'] (inject keys in constructor parameter order).
Available inject keys: user
```

The fix is one line — string literals survive minification:

```typescript
class Session {
  static $constructor = ['user'];
  constructor(public readonly user: string) {}
  // ...
}
```

Add it only when the guard reports a mismatch; in unminified builds parameter-name parsing just works.

## Step 5. Rewrite middleware as `(ctx, next)`

v1 middleware was `(event, ctx, next)` with the parsed body in `ctx.body`, and you short-circuited by returning `buildResponse(...)` / `buildError(...)`. v2 middleware is an onion over the **context**, errors are thrown, and the return value flows back:

```typescript
type Middleware<Ctx> = (ctx: Ctx, next: (ctx: Ctx) => Promise<unknown>) => Promise<unknown>;
```

**Before (v1)** — an auth guard reading the method from the parsed body:

```typescript
composer.use(async (event, ctx, next) => {
  const { method } = ctx.body;
  if (!allowed(method)) throw Error('Permission denied');
  next();
});
```

**After (v2)** — a guard over the context, registered composer-wide or per method:

```typescript
import { compose, RpcError, type Middleware } from '@chord-ts/rpc';

const auth: Middleware<{ user?: string }> = async (ctx, next) => {
  if (!ctx.user) throw new RpcError(-32001, 'Unauthorized');
  return next(ctx);
};

// composer-wide:
const composer = compose({ Session }, { use: auth, inject: { user: (ctx: any) => ctx.user } });

// or per method, inside the declaration:
static $whoami = fn({ in: z.void(), out: z.string(), use: auth });
```

Composer middleware runs first, then the method's `use` chain, then the handler. Thrown errors map to the wire exactly like handler errors ([Step 6](#step-6-throw-json-rpc-errors-with-ready-made-codes)) — the guard above answers:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Unauthorized"}}
```

Two honest differences from v1:

- **Middleware sees `ctx`, not the raw request.** There is no `ctx.body` or method name in the chain. Method-level policy belongs in `fn({ use })` — the declaration already knows which method it guards. If you need request-level inspection (headers, raw body), do it in the platform layer before the adapter, or pass what you need through `locals`/`req.ctx`.
- **No built-in cache middleware yet.** v1's `cacheMiddleware` stays available on the v1 side; in v2 write caching as a middleware around `next(ctx)` or inside the handler.

## Step 6. Throw JSON-RPC errors with ready-made codes

v1 returned `buildError({ code, message, data })` objects and had an `onError` config hook. v2 throws natively — and you don't need to memorize the spec's numbers. `RpcError` has a static factory for every standard JSON-RPC code, plus the reserved server-error code, each with a default message:

| Factory | Code | When |
|---|---|---|
| `RpcError.parseError(message?, data?)` | `-32700` | the received JSON is not parseable |
| `RpcError.invalidRequest(message?, data?)` | `-32600` | the request object is not a valid JSON-RPC request |
| `RpcError.methodNotFound(message?, data?)` | `-32601` | the method does not exist |
| `RpcError.invalidParams(message?, data?)` | `-32602` | the arguments are invalid |
| `RpcError.internal(message?, data?)` | `-32603` | an internal failure |
| `RpcError.serverError(message?, data?)` | `-32000` | an implementation-defined server error (the spec reserves `-32000`…`-32099`) |

```typescript
import { RpcError } from '@chord-ts/rpc';

throw RpcError.invalidParams('Expected a number', { field: 'a' });
```

Executed wire response — code, message and data pass through untouched:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Expected a number","data":{"field":"a"}}}
```

For business errors, `serverError` covers the start of the reserved server range. For other codes in `-32000`…`-32099` — or any custom code — use the constructor:

**Before (v1):**

```typescript
@rpc()
div(a: number, b: number) {
  if (b === 0) return buildError({ code: -32000, message: 'Division by zero', data: { a, b } });
  return a / b;
}
```

**After (v2):**

```typescript
import { z } from 'zod';
import { fn, RpcError } from '@chord-ts/rpc';

class Calc {
  static $div = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  div: typeof Calc.$div.fn = async ({ a, b }) => {
    if (b === 0) throw RpcError.serverError('Division by zero', { a, b });
    return a / b;
  };
}
```

Executed responses — a business error keeps its code and data; a plain `Error` becomes `-32603`:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Division by zero","data":{"a":1,"b":0}}}
{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"Negative input: -1"}}
```

You rarely construct the standard errors yourself: the core already throws them for you — an unknown method answers `-32601`, invalid input answers `-32602` (both shown in [Step 1](#what-a-validation-failure-looks-like)). Reach for the factories when *your* handler needs to signal one of these conditions explicitly; reach for the constructor for domain codes. Any other thrown value (a plain `Error`, a rejected promise) becomes `-32603` with its message.

`RpcError` also accepts an optional HTTP `status` for transports that use it. The `onError` hook is gone — errors flow untouched; if you need central logging, wrap `next(ctx)` in a composer middleware with `try/catch`. The REST binding maps these same throws to HTTP statuses instead of a JSON-RPC envelope ([Step 8](#step-8-serve-rest-endpoints)).

## Step 7. Replace @val with schemas

v1 validated parameters with `@val(zodSchema)` decorators plus a `validator` config. In v2 the `in` schema **is** the validator — it runs on every call, before the handler. `out` always provides the return type; runtime output validation is opt-in:

```typescript
const composer = compose({ Math }, { validateOut: true });
```

With `validateOut: true`, a handler returning the wrong type answers (executed):

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Response validation error",
 "data":[{"expected":"number","code":"invalid_type","path":[],
          "message":"Invalid input: expected number, received string"}]}}
```

**Any Standard Schema library works for validation** — zod 4, valibot and arktype are consumed natively through their `~standard` interface, no adapter needed:

```typescript
import * as v from 'valibot';
static $greet = fn({ in: v.string(), out: v.string() });
```

For **docs generation** the library must also produce JSON Schema. Register `ZodAdapter` once at compose time:

```typescript
import { ZodAdapter } from '@chord-ts/rpc/schemas/zod';
const composer = compose({ Say, Math }, { schemas: new ZodAdapter() });
```

`ZodAdapter` uses zod 4's `z.toJSONSchema` and softens unrepresentable types (`void`, `date`) to `any` so spec generation never throws. Libraries with a native Standard JSON Schema converter work without registration. (yup has no `~standard` interface; a shim exists in the source tree but is not yet exposed as a public subpath in beta.1.)

## Step 8. Serve REST endpoints

v1 spoke JSON-RPC only. v2 can expose the same registry as REST (beta in this revision) — useful for public APIs, webhooks and curl-friendly endpoints. Declare with `get`/`post`/`put`/`patch`/`del` from `@chord-ts/rpc/rest`:

```typescript
import { z } from 'zod';
import { compose, fromSvelteKit } from '@chord-ts/rpc';
import { get, post, rest } from '@chord-ts/rpc/rest';

class Catalog {
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  });

  static $createItem = post('/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });
}

const api = rest(compose({ Catalog }));
export const GET = (event) => fromSvelteKit(api, event);
export const POST = (event) => fromSvelteKit(api, event);
```

The handler input is the merge of three slices — `path`, `query`, `body` — each validated by its own schema. Path parameter names are inferred from the template string. `resp` is a FastAPI-style status map; the schema at `status` (default 200) types the handler return.

> [!TIP]
> Query values arrive as strings. Declare numeric query fields with `z.coerce.number()`.

Mount the REST binding on a catch-all route (`src/routes/api/[...path]/+server.ts` in SvelteKit) — it routes by verb + path internally. Executed responses:

```text
GET  /items/42?q=widget   → 200 {"id":"42","name":"item 42 (widget)"}
POST /items {"name":"widget"} → 201 {"id":"new","name":"widget"}
POST /items {"name":42}   → 422 {"detail":"Validation error"}
GET  /nope                → 404 {"detail":"Not found"}
GET  /boom                → 500 {"detail":"handler exploded"}   (handler threw Error('handler exploded'))
```

Errors map to HTTP statuses, not a JSON-RPC envelope: validation failure → `422`, unknown route → `404`, anything the handler throws → `500` — each with a `{"detail":"..."}` body. The `RpcError` factories and codes from [Step 6](#step-6-throw-json-rpc-errors-with-ready-made-codes) are JSON-RPC vocabulary; under REST, signal failures with the status map in `resp` and thrown errors.

> [!WARNING]
> A class is protocol-consistent: it declares either REST (`get`/`post`) or RPC (`fn`/`stream`), never both. `compose` refuses a mixed class at startup:
> ```text
> [chord] Mixed: mixes REST (get/post) and RPC (fn/stream) declarations in one class — split them into separate services
> ```
> One registry can still serve both protocols — `jsonrpc(composer)` picks up the `fn` endpoints, `rest(composer)` picks up the REST ones.

## Step 9. Generate docs instead of getSchema

v1's `composer.getSchema(route)` needed a configured route and decorator metadata. v2 generates standard documents from the same declarations, and each generator is itself a binding you mount on a GET route of your choice:

```typescript
// src/routes/rpc/spec/+server.ts
import { fromSvelteKit } from '@chord-ts/rpc';
import { openrpc } from '@chord-ts/rpc/jsonrpc';
import { composer } from '../+server';

export const GET = (event) =>
  fromSvelteKit(openrpc(composer, { info: { title: 'My API', version: '1.0.0' } }), event);
```

| Generator | Import | Serves |
|---|---|---|
| `openrpc(composer, opts?)` | `@chord-ts/rpc/jsonrpc` | OpenRPC 1.3 document (JSON) |
| `clef(composer, { endpoint })` | `@chord-ts/rpc/jsonrpc` | clef explorer UI with "Try it" (HTML) |
| `openapi(composer, opts?)` | `@chord-ts/rpc/rest` | OpenAPI 3.1 document (JSON) |
| `swagger(composer)` / `redoc(composer)` | `@chord-ts/rpc/rest` | Swagger UI / ReDoc viewers (HTML) |
| `asyncapi(composer)` | `@chord-ts/rpc/events` | AsyncAPI document for streams |

The JSON-RPC binding also answers `rpc.discover` out of the box — executed against the `Math` class above, it returns an OpenRPC 1.3.2 document listing `Math.add`, `Math.repeat`, `Math.sumAll`. Neutral metadata (`summary`, `desc`, `tags`, `deprecated`) flows from `fn` into every document.

**Check:** `GET /rpc/spec` answers `200` with `{"openrpc":"1.3.2","info":{"title":"My API",...},"methods":[...]}`.

## Step 10. Update the client

The client is typed from the **server binding**, so when the server moves, the client constructor moves with it. The old `client<Client>` still works against v1 endpoints (it is re-exported from `@chord-ts/rpc/client`, deprecated), but a v2 binding needs the v2 constructor:

**Before (v1):**

```typescript
import { client } from '@chord-ts/rpc/client';
import type { Client } from './+server';
const rpc = client<Client>({ endpoint: '/rpc' });
```

**After (v2):**

```typescript
import { jsonrpc } from '@chord-ts/rpc/client';
import type { ClientType } from './+server'; // typeof jsonrpc(composer)

const rpc = jsonrpc<ClientType>({ endpoint: '/rpc' });
const sum = await rpc.Math.add({ a: 2, b: 3 }); // typed: Promise<number>
```

The generic argument is the server binding type — services, argument shapes, return types and the wire format are all derived from it. For a REST binding use `rest<RestApi>({ endpoint, doc })` from the same subpath; `doc` is the OpenAPI manifest the server serves at your spec route (fetch it in `load` or import it).

Know the current limits of the v2 client (beta.1): it is **call-only** and does not yet cover the v1 client's feature set — no `cache`, no `batch`, no `abort`/`signal`, no `onError` hook, no per-call options; notify and stream verbs are not implemented either. Over WebSocket calls are multiplexed by id; an optional `timeout` rejects a never-answered call. If you depend on the missing features today, keep that part of the app on the v1 client (deprecated, still exported from `@chord-ts/rpc/client`) until the v2 client catches up. Errors throw natively: `RpcError` with `code`/`message`/`data` for JSON-RPC, `Error` with `status`/`body` for REST.

HTTP transport failures behave like the v1 `defaultTransport`, adapted to native throws: a network failure throws `RpcError.serverError` with the fetch error as `data`; a redirect navigates via `location.assign` in the browser and throws an `Error` with `data.location` in SSR; a non-2xx response logs status, headers and a trimmed preview (tags stripped, 200 chars) and throws with `{ status, headers, body }` in the error data — an HTML error page is kept as raw text instead of crashing the decoder, while a JSON `{detail}` body is still parsed. A 2xx body that is not the endpoint format throws `RpcError.parseError`.

## New capabilities you can adopt later

These have no v1 counterpart — they are reasons to migrate, not steps of it:

- **Streams.** A third verb next to `fn`: `stream({ in, event })` declares an async-generator handler `(input, signal) => events`. Consume it in-process with `core.stream`:

  ```typescript
  import { z } from 'zod';
  import { stream, compose } from '@chord-ts/rpc';

  class Ticker {
    static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
    countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
      for (let n = from; n > 0; n--) yield { n };
    };
  }

  const core = compose({ Ticker });
  for await (const event of core.stream('Ticker.countdown', { from: 3 })) {
    console.log(event); // { n: 3 }, { n: 2 }, { n: 1 }
  }
  ```

  Every event is validated against `event`; cancellation is native (`AbortSignal` / iterator `return()`).
  Serving streams over WebSocket (`events(composer)` + `fromWsStream`) is **deferred** with the WS
  transport — see the note in Step 3.

- **MCP tools.** `registerMcpTools(server, composer)` from `@chord-ts/rpc/mcp-handler` registers endpoints that carry an `mcp` metadata pocket as tools on an [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) server — same registry, same DI, same validation.
- **Cap'n Web-style capabilities — deferred.** The `./capnweb` subpath is not published until its security review is closed; the code and `design/examples/08-capnweb.ts` stay in the repo for contributors.
- **Custom wire formats.** The transport adapter takes a `Format` handle (`{ contentType, unit, encode, decode }`); `json` is the default. Plug devalue or msgpack by swapping the codec on the binding, the adapter and the client — `design/examples/04-formats.ts` shows the pattern.

Working progressions of all of these live in [`design/examples/`](./design/examples) (01 → 13); the SvelteKit app in [`tests/sveltekit/`](./tests/sveltekit) runs v1 and v2 routes side by side against the published package.

## Known gaps in 2.0.0-beta.1

So you can plan around them:

- **REST is beta** in this revision — JSON-RPC over HTTP is the mature path; expect rough edges in REST.
- **WebSocket transport is not published yet** (`fromWs`/`fromWsStream`, `./transport/ws`): stream multiplexing (many subscriptions per socket) is pending. The client's socket mode (`jsonrpc({ socket })`) remains available; WS calls are multiplexed by id with an optional `timeout`.
- The v2 client is call-only and does not port the v1 client's features yet: no `cache`, `batch`, `abort`/`signal`, `onError` or per-call options (notify/stream verbs are missing too).
- No built-in cache middleware and no `onError` hook on the server side; write them as middleware.
- The yup Standard Schema shim is not publicly exported yet.

## Recap

You can now:

- declare methods schema-first with `fn` and drop decorators, `emitDecoratorMetadata` and the SWC workaround;
- compose classes with typed constructor DI that survives minification;
- serve one registry over SvelteKit and Express — as JSON-RPC and REST;
- throw errors natively and generate OpenRPC/OpenAPI docs from the same declarations;
- type the client from the server binding.

What's next:

- [README](./README.md) — the compact v1→v2 table and the minimal server/client pair.
- [Quick start](./docs/src/content/docs/guides/start.md) and the [docs site](https://chord.vercel.app) — v1 reference while you finish the transition.
- [`design/examples/`](./design/examples) — compile-checked progressions from basic RPC to streams, MCP and Cap'n Web.
