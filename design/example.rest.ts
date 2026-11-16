// Канонический пример REST + мультипротокол. Только пользовательский код, импортирует src.
// Декларации get/post (части path/query/body, resp-карта), биндинги, docs-эндпоинты, транспорт, тулы.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/example.rest.ts

import { z } from 'zod';
import { fn, get, post, compose, rest, jsonrpc, mcp, fromSvelteKit, agentTools } from '../src';
import { ZodAdapter } from '../src/schemas/zod';

type Ctx = { user: string };
type Event = { request: Request; locals: Ctx };

// Класс протокол-согласован: Catalog — чистый REST-ресурс (get/post).
class Catalog {
  constructor(public readonly ctx: Ctx) {}

  // REST GET: item_id выводится из шаблона, query — схемой; resp — карта статусов (FastAPI).
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: {
      200: z.object({ id: z.string(), name: z.string() }),
      404: z.object({ detail: z.string() }),
    },
    desc: 'Получить предмет',
    tags: ['items'],
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  });

  // REST POST: тело — часть body; статус успеха 201.
  static $createItem = post('/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
    desc: 'Создать предмет',
    tags: ['items'],
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });
}

// RPC-сервис — отдельный класс (fn). Смешивать REST и fn в одном классе нельзя.
class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

// Один compose на все протоколы; вендорный адаптер схем регистрируется здесь.
const composer = compose(
  { Catalog, Math },
  { inject: { ctx: (e: Event) => e.locals }, schemas: new ZodAdapter() },
);

// Биндинги по имени протокола. Docs-эндпоинты транзитивны: rest сам отдаёт /openapi.json, /docs, /redoc.
const api = rest(composer);
const rpc = jsonrpc(composer); // + rpc.discover
const tools = mcp(composer); // tools/list + tools/call (+ initialize)

// Уровень эндпоинта: одна строка на транспорт. SvelteKit catch-all [...path]/+server.ts.
export const GET = (event: Event) => fromSvelteKit(api, event);
export const POST = (event: Event) => fromSvelteKit(api, event);
// JSON-RPC: export const POST = (e) => fromSvelteKit(rpc, e);
// MCP:      export const POST = (e) => fromSvelteKit(tools, e);

// Агентские тулы in-process (LangChain): schema — нативный zod, invoke/func поверх ядра.
const lcTools = agentTools(composer);
console.log(lcTools.map((t) => t.name));