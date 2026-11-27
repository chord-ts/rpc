// v2 REST-эндпоинт: catch-all, т.к. rest роутит по пути+глаголу. Пути объявлены под /v2/rest.
// rest — чистый роутинг; docs (openapi.json/docs/redoc) — отдельные GET-подроуты рядом,
// их путь выбираем сами (никакого предположения о корне). Импорт из опубликованного пакета.
import { compose, fromSvelteKit } from '@chord/rpc';
import { get, post, rest, HttpError } from '@chord/rpc/rest';
import { z } from 'zod';

class Catalog {
  constructor() {}
  static $getItem = get('/v2/rest/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({
    id: item_id,
    name: `item ${item_id}${q ? ` (${q})` : ''}`,
  });

  static $createItem = post('/v2/rest/items', {
    body: z.object({ name: z.string() }),
    resp: { 201: z.object({ id: z.string(), name: z.string() }) },
    status: 201,
  });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });
}

// Новые примеры (раунд 4): array-query, record-body, non-object body-слот, HttpError + resp-карта.
class Demo {
  constructor() {}

  // Array-query: ?tag=a&tag=b → ['a','b']; одиночный ?tag=a → ['a']; без ключа → [].
  static $search = get('/v2/rest/search', {
    query: z.object({ tag: z.array(z.string()) }),
    resp: { 200: z.object({ tags: z.array(z.string()) }) },
  });
  search: typeof Demo.$search.fn = async ({ tag }) => ({ tags: tag });

  // Record-body (без properties): клиент шлёт плоскую карту, сервер мержит плоско.
  static $meta = post('/v2/rest/meta', {
    body: z.record(z.string(), z.number()),
    resp: { 200: z.object({ sum: z.number() }) },
  });
  meta: typeof Demo.$meta.fn = async (input) => ({
    sum: Object.values(input).reduce((a, b) => a + b, 0),
  });

  // Non-object body (массив) живёт под ключом body: клиент rpc.Demo.sum({ body: [1,2,3] }).
  static $sum = post('/v2/rest/sum', {
    body: z.array(z.number()),
    resp: { 200: z.number() },
  });
  sum: typeof Demo.$sum.fn = async ({ body }) => body.reduce((a, b) => a + b, 0);

  // HttpError со статусом и data: data становится телом ответа под схему resp[409].
  static $createOrder = post('/v2/rest/orders', {
    body: z.object({ sku: z.string() }),
    resp: {
      201: z.object({ id: z.string() }),
      409: z.object({ code: z.string(), retryAfter: z.number() }),
    },
    status: 201,
  });
  createOrder: typeof Demo.$createOrder.fn = async ({ sku }) => {
    if (sku === 'DUP') throw new HttpError(409, 'Conflict', { code: 'DUP', retryAfter: 5 });
    return { id: `order-${sku}` };
  };
}

// '_' префикс: SvelteKit разрешает только HTTP-хэндлеры/config/_-экспорты из +server.ts.
export const _composer = compose({ Catalog, Demo });
const restApi = rest(_composer);
export type RestApi = typeof restApi;

export const GET = (event: { request: Request }) => fromSvelteKit(restApi, event);
export const POST = (event: { request: Request }) => fromSvelteKit(restApi, event);

