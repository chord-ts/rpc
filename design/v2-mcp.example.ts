// Пользовательский код: MCP-тулы для эндпоинтов + переиспользование на сервере (LangChain).
// Один вендорный адаптер (ZodAdapter) регистрируется в композере — дальше ни одного
// прямого вызова zod: генераторы, биндинги и tools() берут схемы из адаптера под капотом.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-mcp.example.ts

import { z } from 'zod';
import { fn, get, post, compose, mcp } from './v2-transport.helpers';
import { ZodAdapter } from './v2-schemas.helpers';

class Catalog {
  constructor() {}

  // REST-эндпоинт станет MCP-тулом с плоским inputSchema (path+query+body)
  // и аннотациями из глагола: GET → readOnlyHint.
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
    desc: 'Получить предмет',
    tags: ['items'],
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  });

  static $createItem = post('/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
    desc: 'Создать предмет',
    tags: ['items'],
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });

  // fn-эндпоинт: скалярный in → тул с обёрткой { value } (адаптер делает сам).
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Catalog.$count.fn = async (n) => n + 1;
}

// Один адаптер на всю библиотеку валидации: JSON Schema, плоские схемы, обёртки.
const composer = compose({ Catalog }, { inject: {}, schemas: new ZodAdapter() });

(async () => {
  // --- 1. MCP-провод: tools/list + tools/call (удалённый агент) ---
  const server = mcp(composer); // конвертер не передаём — он в композере
  const rpc = (method: string, params: unknown, id: number) => ({
    method: 'POST',
    url: 'http://localhost/mcp',
    text: async () => JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  });

  const list = await server.handle(rpc('tools/list', {}, 1));
  console.log('=== MCP tools/list ===');
  console.log(JSON.stringify(JSON.parse(list.body!).result, null, 2));

  const callRest = await server.handle(rpc('tools/call', { name: 'Catalog.getItem', arguments: { item_id: '42', q: 'hello' } }, 2));
  console.log('=== MCP tools/call Catalog.getItem ===', callRest.body);

  const callFn = await server.handle(rpc('tools/call', { name: 'Catalog.count', arguments: { value: 41 } }, 3));
  console.log('=== MCP tools/call Catalog.count ===', callFn.body);

  // --- 2. In-process: готовые тулы для LangChain/аналогов, без провода ---
  const tools = composer.tools();
  const getItem = tools.find((t) => t.name === 'Catalog.getItem')!;

  // invoke — вызов ядра с упаковкой аргументов (тот же шов, что на проводе).
  console.log('=== tools().invoke (in-process) ===', JSON.stringify(await getItem.invoke({ item_id: '42', q: 'hello' })));

  // func — готовый строковый вызов для фреймворка.
  console.log('=== tools().func ===', await getItem.func({ item_id: '7' }));

  // LangChain: схема уже вендорная (zod), адаптер всё разрулил внутри.
  // import { DynamicStructuredTool } from '@langchain/core/tools';
  // const lcTools = composer.tools().map((t) => new DynamicStructuredTool({
  //   name: t.name, description: t.description, schema: t.schema, func: t.func,
  // }));
  console.log('=== t.schema (готовая zod-схема тула) ===', JSON.stringify(getItem.schema['~standard'].validate({ item_id: '7', q: 'x' })));
})();