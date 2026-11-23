import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, get, post, compose, jsonrpc, rest, type TransportRequest } from '../index';
import { ZodAdapter } from '../schemas/zod';

class Catalog {
  constructor() {}

  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string(), name: z.string() }) },
    desc: 'Получить предмет',
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

// RPC-сервис отдельным классом (REST и fn не смешиваются в одном классе).
class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number() });
  count: typeof Math.$count.fn = async (n) => n + 1;
  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll: typeof Math.$sumAll.fn = async (nums) => nums.reduce((a, b) => a + b, 0);
}

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });
// value-level шов: тело — уже значение (без raw text()).
const req = (method: string, path: string, body?: unknown): TransportRequest => ({
  method,
  url: `http://localhost${path}`,
  body,
});
const rpcBody = (method: string, params: unknown, id?: number) =>
  req('POST', '/rpc', { jsonrpc: '2.0', method, params, id });

test('jsonrpc: call, notification (204), rpc.discover', async () => {
  const binding = jsonrpc(composer).http;
  const call = await binding.handle(rpcBody('Math.count', 5, 1));
  expect(call.body).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });

  // стандартная by-position форма скаляра [value] — как шлют clef и OpenRPC-клиенты
  const positional = await binding.handle(rpcBody('Math.count', [5], 3));
  expect(positional.body).toEqual({ jsonrpc: '2.0', id: 3, result: 6 });

  // массив-как-значение — [[…]] (клиент оборачивает одиночный array-аргумент)
  const arr = await binding.handle(rpcBody('Math.sumAll', [[1, 2, 3]], 4));
  expect(arr.body).toEqual({ jsonrpc: '2.0', id: 4, result: 6 });

  const notify = await binding.handle(rpcBody('Math.count', 5));
  expect(notify.status).toBe(204);

  const discover = await binding.handle(rpcBody('rpc.discover', undefined, 2));
  expect((discover.body as any).result.openapi).toBeUndefined();
  expect((discover.body as any).result.openrpc).toBe('1.3.2');
});

test('rest: GET routing + slices, POST 201, validation 422 (pure routing, no docs)', async () => {
  const binding = rest(composer).http;
  const got = await binding.handle(req('GET', '/items/42?q=hi'));
  expect(got.status).toBe(200);
  expect(got.body).toEqual({ id: '42', name: 'item 42 (hi)' });

  const created = await binding.handle(req('POST', '/items', { name: 'widget' }));
  expect(created.status).toBe(201);
  expect(created.body).toEqual({ id: 'new', name: 'widget' });

  const invalid = await binding.handle(req('POST', '/items', { name: 123 }));
  expect(invalid.status).toBe(422);

  // docs больше не живут внутри rest — отдельный binding (openapi/swagger/redoc).
  const docs = await binding.handle(req('GET', '/docs'));
  expect(docs.status).toBe(404);
});

test('jsonrpc: message-проекция — значения, notification → null', async () => {
  const { message } = jsonrpc(composer);
  const call = await message.handle({ jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 });
  expect(call).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });
  expect(await message.handle({ jsonrpc: '2.0', method: 'Math.count', params: 5 })).toBeNull();
});

test('jsonrpc: batch из одних notification → null / 204 (спека: пустой batch не шлётся)', async () => {
  const rpc = jsonrpc(composer);
  const notifications = [{ jsonrpc: '2.0', method: 'Math.count', params: 5 }];
  expect(await rpc.message.handle(notifications)).toBeNull();
  const res = await rpc.http.handle(req('POST', '/rpc', notifications));
  expect(res.status).toBe(204);
});

