// v2 REST-эндпоинт: catch-all, т.к. rest роутит по пути+глаголу. Пути объявлены под /v2/rest,
// docs-эндпоинты смещены туда же. Импорт из опубликованного пакета (@chord/rpc, v2-имена).
import { compose, get, post, rest, fromSvelteKit } from '@chord/rpc';
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

const composer = compose({ Catalog });
const restApi = rest(composer, {
  docs: true,
});
export type RestApi = typeof restApi;

export const GET = (event: { request: Request }) => fromSvelteKit(restApi, event);
export const POST = (event: { request: Request }) => fromSvelteKit(restApi, event);

