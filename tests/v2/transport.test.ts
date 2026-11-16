import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, get, compose, rest, jsonrpc, fromSvelteKit, fromExpress } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';

class Catalog {
  constructor() {}
  static $getItem = get('/items/{item_id}', {
    resp: { 200: z.object({ id: z.string() }) },
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id }) => ({ id: item_id });
}

class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number() });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });

test('fromSvelteKit: binding → fetch Response', async () => {
  const res = await fromSvelteKit(rest(composer), {
    request: { method: 'GET', url: 'http://localhost/items/42', text: async () => '' },
    locals: {},
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(await res.json()).toEqual({ id: '42' });
});

test('fromExpress: structural req/res → JSON-RPC response', async () => {
  const captured: { status?: number; body?: string | null; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return res; },
    set(field: string, value: string) { captured.headers[field] = value; return res; },
    send(body?: string | null) { captured.body = body; return res; },
  };
  await fromExpress(
    jsonrpc(composer),
    { method: 'POST', url: '/rpc', body: { jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 } },
    res,
  );
  expect(captured.status).toBe(200);
  expect(JSON.parse(captured.body!)).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });
});