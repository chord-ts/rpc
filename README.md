<div id="header" align="center">
<img src="./assets/readme/hero.svg" width="100%" alt="Chord — type-safe RPC on JSON-RPC v2: write a typed method once on the server, call it from the client like a local function." />
💎 Remote call & local feel — contracts keep it hyper real
<br/>

<a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white"></a>
<a href="https://kit.svelte.dev/"><img alt="SvelteKit" src="https://img.shields.io/badge/SvelteKit-191919?style=for-the-badge&logo=svelte&logoColor=FF3E00"></a>
<a href="https://expressjs.com/"><img alt="Express" src="https://img.shields.io/badge/Express-69b74d?style=for-the-badge&logo=express&logoColor=white"></a>
<a href="https://www.jsonrpc.org/specification"><img alt="JSON-RPC" src="https://img.shields.io/badge/JSONRPC-18181a?style=for-the-badge&logo=json&logoColor=white"></a>
</div>

<div align="center">
  <img alt="download stats" src="https://img.shields.io/npm/dm/@chord-ts/rpc?style=flat&color=218380">
  <img alt="version" src="https://img.shields.io/npm/v/@chord-ts/rpc?style=flat&color=3F4CF8&label=latest">
  <img alt="license" src="https://img.shields.io/npm/l/@chord-ts/rpc?color=D81159">
  <img alt="maintainability" src="https://img.shields.io/codeclimate/maintainability/chord-ts/rpc?color=04E762">
</div>

<!-- 
## ✅ Used inside

<div align="center">
  <a href="https://sbermarketing.ru">
    <img alt="SberMarketing" src="./docs/public/SBER_MARKETING_LOGO.png" width="200"/>
  </a>
</div> -->

## 🥏 Why?

As a project grows, client–server communication becomes a maintenance burden. Hundreds of REST endpoints erode developer experience; GraphQL feels heavy for many use cases, and gRPC is built for server-to-server, not the browser.

**Chord** lets you write a typed method once and call it from the client as if it lived in the same file — no codegen, no schema sync, no decorators.

## ✨ Features (v2)

* **Schema-first** — one `fn({ in, out })` declaration drives types, runtime validation, and docs
* **Type-safe end-to-end** — the client is typed from the server binding; IDE autocompletion out of the box
* **Multi-protocol** — JSON-RPC, REST, MCP (via `mcp-handler`) from a single registry
* **Transport adapters** — SvelteKit, Express; protocol-agnostic, you own the transport
* **Docs generation** — OpenRPC / OpenAPI / AsyncAPI plus clef / Swagger / ReDoc viewers
* **Granular subpaths** — import only what you use; the root stays small and tree-shakeable

## ⚙️ Installation

```bash
npm install @chord-ts/rpc zod
# or
pnpm add @chord-ts/rpc zod
```

`zod` is an optional peer dependency (used by `ZodAdapter` for schema conversion). v2 needs **no decorators** and no `emitDecoratorMetadata` — types come from the schema, not reflection.

## 🛠️ Usage

The example uses [SvelteKit](https://kit.svelte.dev/); the same pattern works on Next.js, Nuxt, Express, or any backend.

### 📝 Server

**`./src/routes/+server.ts`**

```typescript
import { z } from 'zod';
import { compose, fn, jsonrpc, fromSvelteKit } from '@chord-ts/rpc';
import { ZodAdapter } from '@chord-ts/rpc/schemas/zod';

// 1. Declare a service: schema-first methods, no decorators
class Math {
  static $add = fn({
    in: z.object({ a: z.number(), b: z.number() }),
    out: z.number(),
    desc: 'Adds two numbers',
  });
  add = Math.$add(async ({ a, b }) => a + b);
}

// 2. Compose the registry and pick a protocol binding
const composer = compose({ Math }, { schemas: new ZodAdapter() });
const api = jsonrpc(composer);

// 3. Export the binding type for the client
export type ClientType = typeof api;

// 4. Hand the binding to a transport adapter
export const POST = (event) => fromSvelteKit(api, event);
```

### 🖥️ Client

**`./src/routes/+page.svelte`**

```html
<script lang="ts">
  import { jsonrpc } from '@chord-ts/rpc/client';
  import type { ClientType } from './+server';

  // Typed from the server binding — Math.add is (args: {a,b}) => Promise<number>
  const rpc = jsonrpc<ClientType>({ endpoint: '/' });
  let sum = rpc.Math.add({ a: 2, b: 3 });
</script>

<p>2 + 3 = {await sum}</p>
```

### 📦 Subpaths

The root re-exports the essentials (`compose`, `fn`, `jsonrpc`, transport adapters). Everything else lives in granular subpaths — including `ZodAdapter` at `@chord-ts/rpc/schemas/zod`, so the root never pulls in zod unless you opt in:

| Import | What |
|---|---|
| `@chord-ts/rpc/rest` | REST sugar (`get`/`post`/…) + OpenAPI/Swagger/ReDoc |
| `@chord-ts/rpc/jsonrpc` | JSON-RPC binding + OpenRPC/clef docs |
| `@chord-ts/rpc/transport/sveltekit` · `/express` | per-platform adapters |
| `@chord-ts/rpc/schemas/zod` | `ZodAdapter` |
| `@chord-ts/rpc/client` | typed client constructors |
| `@chord-ts/rpc/mcp-handler` | MCP 2026-07-28 bridge |
| `@chord-ts/rpc/events` · `/mcp` · `/tools` | events/AsyncAPI, MCP tools, agent tools (`agentTools`) |

> **Not published yet** (code stays in `src` for contributors):
> - Cap'n Web-style capabilities (`./capnweb`) — until the security review is closed.
> - WebSocket transport (`./transport/ws`, `fromWs`/`fromWsStream`) — until stream multiplexing
>   lands. The client's socket mode (`jsonrpc({ socket })` from `./client`) remains available.

## 🔁 Migrating from v1

v1 still ships (deprecated) and the root re-exports it, so existing imports keep working. v2 is a new, non-overlapping API — migrate incrementally. For the step-by-step server migration, see [MIGRATION.md](./MIGRATION.md).

| v1 | v2 |
|---|---|
| `Composer.init({ Say: new Say() })` | `compose({ Say }, { schemas: new ZodAdapter() })` |
| `@rpc()` decorator on a method | `static $hello = fn({ in, out })` + `hello = Say.$hello(async …)` |
| `experimentalDecorators` / `emitDecoratorMetadata` | not needed — schema-first |
| `composer.use(sveltekitMiddleware())` + `composer.exec(event)` | `fromSvelteKit(jsonrpc(composer), event)` |
| `client<Client>({ endpoint })` | `jsonrpc<typeof api>({ endpoint })` from `/client` |
| `typeof composer.clientType` | `typeof jsonrpc(composer)` |
| validation via decorator metadata | `fn({ in: z…, out: z… })` + `ZodAdapter` |

**Before (v1):**

```typescript
import { Composer, rpc } from '@chord-ts/rpc';
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
import { json } from '@sveltejs/kit';

class Say {
  @rpc()
  hello(name: string): string { return `Hello, ${name}!`; }
}
const composer = Composer.init({ Say: new Say() });
composer.use(sveltekitMiddleware());
export const POST = async (event) => json(await composer.exec(event));
```

**After (v2):**

```typescript
import { z } from 'zod';
import { compose, fn, jsonrpc, fromSvelteKit } from '@chord-ts/rpc';
import { ZodAdapter } from '@chord-ts/rpc/schemas/zod';

class Say {
  static $hello = fn({ in: z.string(), out: z.string() });
  hello = Say.$hello(async (name) => `Hello, ${name}!`);
}
const api = jsonrpc(compose({ Say }, { schemas: new ZodAdapter() }));
export const POST = (event) => fromSvelteKit(api, event);
```

> v1 relies on decorators and `emitDecoratorMetadata` (with the SWC workaround under Vite). v2 drops both: the schema is the single source of types and validation. See [`/docs`](./docs) for the full v1 reference.

## 📚 Further reading

The [documentation](https://chord.vercel.app) walks through validation, transports, REST, streaming, and MCP; the full reference lives in [`/docs`](./docs), and design notes in [`/design`](./design).