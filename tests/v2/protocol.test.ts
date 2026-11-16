import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, get, post, compose, jsonrpc, rest, mcp, type TransportRequest } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';

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

  static $count = fn({ in: z.number(), out: z.number() });
  count: typeof Catalog.$count.fn = async (n) => n + 1;
}

const composer = compose({ Catalog }, { inject: {}, schemas: new ZodAdapter() });
const req = (method: string, path: string, body?: unknown): TransportRequest => ({
  method,
  url: `http://localhost${path}`,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const rpcBody = (method: string, params: unknown, id?: number) =>
  req('POST', '/rpc', { jsonrpc: '2.0', method, params, id });

test('jsonrpc: call, notification (204), rpc.discover', async () => {
  const binding = jsonrpc(composer);
  const call = await binding.handle(rpcBody('Catalog.count', 5, 1));
  expect(JSON.parse(call.body!)).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });

  const notify = await binding.handle(rpcBody('Catalog.count', 5));
  expect(notify.status).toBe(204);

  const discover = await binding.handle(rpcBody('rpc.discover', undefined, 2));
  expect(JSON.parse(discover.body!).result.openapi).toBeUndefined();
  expect(JSON.parse(discover.body!).result.openrpc).toBe('1.3.2');
});

test('rest: GET routing + slices, POST 201, validation 422, docs', async () => {
  const binding = rest(composer);
  const get = await binding.handle(req('GET', '/items/42?q=hi'));
  expect(get.status).toBe(200);
  expect(JSON.parse(get.body!)).toEqual({ id: '42', name: 'item 42 (hi)' });

  const created = await binding.handle(req('POST', '/items', { name: 'widget' }));
  expect(created.status).toBe(201);
  expect(JSON.parse(created.body!)).toEqual({ id: 'new', name: 'widget' });

  const invalid = await binding.handle(req('POST', '/items', { name: 123 }));
  expect(invalid.status).toBe(422);

  const spec = await binding.handle(req('GET', '/openapi.json'));
  expect(spec.status).toBe(200);
  expect(JSON.parse(spec.body!).openapi).toBe('3.1.0');

  const docs = await binding.handle(req('GET', '/docs'));
  expect(docs.status).toBe(200);
  expect(docs.headers['content-type']).toContain('text/html');
});

test('mcp: tools/list + tools/call (scalar unwrap)', async () => {
  const binding = mcp(composer);
  const list = await binding.handle(rpcBody('tools/list', {}, 1));
  const names = JSON.parse(list.body!).result.tools.map((t: any) => t.name);
  expect(names).toEqual(expect.arrayContaining(['Catalog.getItem', 'Catalog.count']));

  const call = await binding.handle(rpcBody('tools/call', { name: 'Catalog.count', arguments: { value: 41 } }, 2));
  expect(JSON.parse(call.body!).result.content[0].text).toBe('42');
});