// Пользовательский код: подключение транспорта и использование на уровне эндпоинта.
// Протокол выбирается ЯВНО на двух уровнях:
//   декларация — fn({}) / get·post(path, {}) / http(meta, {});
//   подключение — биндинг jsonrpc(composer) / rest(composer) / mcp(composer).
// Транспорт (fromSvelteKit/fromExpress) протокола не знает — только гоняет байты в биндинг.
// Прогон:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-transport.example.ts

import { z } from 'zod';
import {
  fn,
  get,
  post,
  compose,
  jsonrpc,
  rest,
  mcp,
  fromSvelteKit,
  type Middleware,
} from './v2-transport.helpers';
import { ZodAdapter } from './v2-schemas.helpers';

// --- домен ---
type Ctx = { user: { id: string; name: string } };
type Logger = { log: (msg: string) => void };
type Event = { request: Request; locals: Ctx; logger: Logger };

const logCalls: Middleware = async (ctx, next) => next(ctx);

class Catalog {
  constructor(
    public readonly ctx: Ctx,
    public readonly logger: Logger,
  ) {}

  // REST GET: параметры частями, как в FastAPI. item_id выводится из шаблона (string),
  // query объявлен схемой; вход обработчика — их пересечение. resp — карта статусов,
  // схема успеха (200) типизирует возврат. Нейтральные поля (desc/tags) читают все генераторы.
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional(), limit: z.coerce.number().optional() }),
    resp: {
      200: z.object({ id: z.string(), name: z.string() }),
      404: z.object({ detail: z.string() }),
    },
    desc: 'Получить предмет',
    tags: ['items'],
    use: logCalls,
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q, limit }) => {
    this.logger.log(`getItem(${item_id}, ${q ?? ''}, ${limit ?? 0})`);
    return { id: item_id, name: `item ${item_id}` };
  };

  // REST POST: тело — отдельная часть body; статус успеха 201, его схема в resp (FastAPI-подобно).
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
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => {
    return { id: 'new', name };
  };

  // Чистый RPC (без REST): доступен через JSON-RPC и MCP, но не в REST-роутере.
  static $count = fn({ in: z.number(), out: z.number(), mcp: { desc: 'Инкремент' } });
  count: typeof Catalog.$count.fn = async (n) => n + 1;

  // Simple-эндпоинт: публичный метод без $method, тип из сигнатуры, без валидации.
  async noCheck(name: string) {
    return `Hello, ${name}`;
  }

  // Приватное (#) в эндпоинты не попадает.
  #greet(name: string) {
    return `Hello, ${name}!`;
  }
}

// Регистрация одна на все транспорты/протоколы. Ядро протокол-агностично (не «toRPC»).
// Один вендорный адаптер схем — генераторы/биндинги/tools берут его под капотом.
const composer = compose(
  { Catalog },
  {
    inject: {
      ctx: (e: Event) => e.locals,
      logger: (e: Event) => e.logger,
    },
    schemas: new ZodAdapter(),
  },
);

// --- биндинги протоколов: явный выбор ---
// Стандартные эндпоинты транзитивны протоколу и появляются сами (как в FastAPI):
//   rest → GET /openapi.json, /docs (Swagger UI), /redoc;
//   jsonrpc → метод rpc.discover (OpenRPC-документ);
//   mcp → tools/list.
// Конвертер схем не передаём — вендорный адаптер зарегистрирован в композере.
const api = rest(composer); // REST + docs из коробки
const rpc = jsonrpc(composer); // JSON-RPC 2.0 + rpc.discover
const tools = mcp(composer); // MCP: tools/list + tools/call

// --- уровень эндпоинта: одна строка, протокол виден ---

// REST: src/routes/api/[...path]/+server.ts — catch-all, роутит внутри биндинг.
export const GET = (event: Event) => fromSvelteKit(api, event);
export const POST = (event: Event) => fromSvelteKit(api, event);

// JSON-RPC: src/routes/rpc/+server.ts
// export const POST = (event: Event) => fromSvelteKit(rpc, event);

// MCP: src/routes/mcp/+server.ts
// export const POST = (event: Event) => fromSvelteKit(tools, event);

// Express тем же биндингом: app.all('/api/*', (req, res) => fromExpress(api, req, res));

// --- gasket: протокол-агностичные вербы (для биндингов и серверной композиции) ---
const result = await composer.call('Catalog.count', 1, { ctx: { user: { id: '1', name: 'dmdin' } } });
if (result.ok) console.log(result.value);
await composer.notify('Catalog.count', 1); // fire-and-forget

// --- реестр → артефакты протоколов ---
// Один класс → несколько протоколов: rest и mcp на одном эндпоинте — два артефакта
// из одного реестра, а не два описания.
for (const { service, method, contract } of composer.endpoints()) {
  const restMeta = contract?.rest as { method: string; endpoint: string } | undefined;
  const mcpMeta = contract?.mcp as { desc?: string } | undefined;
  console.log(`${service}.${method}`, restMeta?.endpoint ?? '(no rest)', mcpMeta?.desc ?? '');
}

// Метаданные доступны и напрямую из статики (типизировано):
const path: string = Catalog.$getItem.rest.endpoint; // '/items/{item_id}'
const status: number | undefined = Catalog.$createItem.rest.status; // 201
console.log(path, status);