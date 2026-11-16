// Пользовательский код: один сервис → артефакты, транзитивные протоколу.
// REST-декларации (get/post) → OpenAPI + /docs + /redoc + /openapi.json (сами, как в FastAPI).
// fn-декларации → OpenRPC (rpc.discover) + MCP tools/list.
// stream-метаданные → AsyncAPI (гипотеза).
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-generate.example.ts

import { z } from 'zod4';
import { fn, get, post, compose, rest, jsonrpc, mcp } from './v2-transport.helpers';
import { openapi, openrpc, mcpTools, asyncapi } from './v2-generate.helpers';
import { ZodAdapter } from './v2-schemas.helpers';

type Ctx = { user: string };

class Catalog {
  constructor(public readonly ctx: Ctx) {}

  // REST: параметры частями. item_id выводится из шаблона '{item_id}' → string,
  // query — схемой (числа из URL coerce'ятся). Вход обработчика = path & query & body.
  // resp — карта статусов (FastAPI responses): схема 200 — возврат обработчика.
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional(), limit: z.coerce.number().optional() }),
    resp: {
      200: z.object({ id: z.string(), name: z.string() }),
      404: z.object({ detail: z.string() }),
    },
    desc: 'Получить предмет',
    tags: ['items'],
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q, limit }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q}, ${limit ?? 0})` : ''}`,
  });

  // status: 201 — успех; его схема в resp типизирует возврат и валидируется ядром.
  static $createItem = post('/items', {
    body: z.object({ name: z.string() }),
    resp: {
      201: z.object({ id: z.string(), name: z.string() }),
      409: z.object({ detail: z.string() }),
    },
    status: 201,
    desc: 'Создать предмет',
    tags: ['items'],
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });

  // Чистый RPC: транзитивен JSON-RPC/MCP — попадёт в OpenRPC и tools/list, но не в OpenAPI.
  // Скалярный in для MCP обернётся в { value: number }, биндинг распакует обратно.
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Catalog.$count.fn = async (n) => n + 1;

  // ГИПОТЕЗА stream: канал + схема события (out). Обработчик stream — отдельный дизайн
  // (AsyncIterable вместо Promise), здесь важен только источник схемы для AsyncAPI.
  static $ticks = fn({
    in: z.object({ every: z.number() }),
    out: z.object({ tick: z.number() }),
    stream: { channel: 'ticks' },
    desc: 'Поток тиков',
  });
}

// Один вендорный адаптер на всё: генераторы берут конвертер из композера под капотом.
const composer = compose({ Catalog }, { inject: { ctx: (e: Ctx) => e }, schemas: new ZodAdapter() });

const opts = { info: { title: 'Catalog', version: '1.0.0' } };

// --- standalone-генераторы (те же, что биндинги отдают сами) ---
console.log('=== OpenAPI 3.1 (Swagger UI) ===');
console.log(JSON.stringify(openapi(composer, opts), null, 2));

console.log('=== OpenRPC 1.3 (только fn-методы) ===');
console.log(JSON.stringify(openrpc(composer, opts), null, 2));

console.log('=== MCP tools/list (все эндпоинты со схемой) ===');
console.log(JSON.stringify(mcpTools(composer, opts), null, 2));

console.log('=== AsyncAPI 3.0 (гипотеза stream) ===');
console.log(JSON.stringify(asyncapi(composer, opts), null, 2));

// --- стандартные эндпоинты живут сами: проверяем живьём ---
(async () => {
  const api = rest(composer, opts);
  const fakeGet = (path: string) => ({ method: 'GET', url: `http://localhost${path}`, text: async () => '' });

  const spec = await api.handle(fakeGet('/openapi.json'));
  console.log('=== GET /openapi.json ===', spec.status, spec.headers['content-type'], `${spec.body?.length} bytes`);

  const docs = await api.handle(fakeGet('/docs'));
  console.log('=== GET /docs ===', docs.status, docs.headers['content-type']);
  console.log(docs.body);

  const redoc = await api.handle(fakeGet('/redoc'));
  console.log('=== GET /redoc ===', redoc.status, redoc.headers['content-type']);

  // REST-вызов со срезами: path из URL, query coerce'ится схемой.
  const item = await api.handle({
    method: 'GET',
    url: 'http://localhost/items/42?q=hello&limit=5',
    text: async () => '',
  });
  console.log('=== GET /items/42?q=hello&limit=5 ===', item.status, item.body);

  // POST: успех 201 (схема из resp[201] валидирует возврат ядром).
  const created = await api.handle({
    method: 'POST',
    url: 'http://localhost/items',
    text: async () => JSON.stringify({ name: 'widget' }),
  });
  console.log('=== POST /items {name:"widget"} ===', created.status, created.body);

  // Невалидное тело → 422 (FastAPI-подобно, ошибка валидации).
  const invalid = await api.handle({
    method: 'POST',
    url: 'http://localhost/items',
    text: async () => JSON.stringify({ name: 123 }),
  });
  console.log('=== POST /items {name:123} ===', invalid.status, invalid.body);

  // JSON-RPC: rpc.discover отдаёт OpenRPC-документ без регистрации метода.
  const rpc = jsonrpc(composer, opts);
  const discovered = await rpc.handle({
    method: 'POST',
    url: 'http://localhost/rpc',
    text: async () => JSON.stringify({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
  });
  console.log('=== rpc.discover ===', discovered.status, discovered.body?.slice(0, 120), '…');

  // MCP: скалярный count — обёртка { value } распаковывается биндингом.
  const tools = mcp(composer);
  const called = await tools.handle({
    method: 'POST',
    url: 'http://localhost/mcp',
    text: async () =>
      JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'Catalog.count', arguments: { value: 41 } }, id: 1 }),
  });
  console.log('=== MCP tools/call count { value: 41 } ===', called.status, called.body);
})();