// Регрессии по ревью (B2/B3/H2): JSON-RPC 2.0 conformance + защита от падения одним запросом.
// Тела шлются напрямую в binding.handle (без exec-helper, который сам добавляет jsonrpc:'2.0').

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose, jsonrpc, ErrorCode, RpcError, type Middleware } from '../index';
import { ZodAdapter } from '../schemas/zod';

class Svc {
  static $echo = fn({ in: z.string(), out: z.string() });
  echo = Svc.$echo(async (s) => s);

  static $noop = fn({ in: z.void(), out: z.void() });
  noop = Svc.$noop(async () => {});
}

// ZodAdapter: rpc.discover генерирует OpenRPC, void-схема требует unrepresentable:'any'.
const rpc = jsonrpc(compose({ Svc }, { inject: {}, schemas: new ZodAdapter() }));
const handle = (body: unknown) => rpc.message.handle(body);
const ok = { jsonrpc: '2.0', method: 'Svc.echo', params: 'x', id: 1 };

test('B2: missing / wrong jsonrpc version → InvalidRequest (-32600), not executed', async () => {
  expect(await handle({ method: 'Svc.echo', params: 'x', id: 1 })).toMatchObject({
    id: 1,
    error: { code: ErrorCode.InvalidRequest },
  });
  expect(await handle({ jsonrpc: '1.0', method: 'Svc.echo', params: 'x', id: 1 })).toMatchObject({
    error: { code: ErrorCode.InvalidRequest },
  });
});

test('B2: invalid method (number / absent) → InvalidRequest, NOT MethodNotFound', async () => {
  expect(await handle({ jsonrpc: '2.0', method: 42, id: 1 })).toMatchObject({ error: { code: ErrorCode.InvalidRequest } });
  expect(await handle({ jsonrpc: '2.0', id: 1 })).toMatchObject({ error: { code: ErrorCode.InvalidRequest } });
});

test('params: bare scalar and by-position [value] both accepted (chord wire contract)', async () => {
  expect(await handle({ jsonrpc: '2.0', method: 'Svc.echo', params: 'x', id: 1 })).toMatchObject({ result: 'x' });
  expect(await handle({ jsonrpc: '2.0', method: 'Svc.echo', params: ['x'], id: 2 })).toMatchObject({ result: 'x' });
});

test('B2: empty batch [] → ONE InvalidRequest error object (not null)', async () => {
  const res = await handle([]);
  expect(res).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.InvalidRequest } });
  expect(Array.isArray(res)).toBe(false);
});

test('B2: batch of primitives [1,2,3] → array of InvalidRequest errors', async () => {
  const res = (await handle([1, 2, 3])) as unknown[];
  expect(Array.isArray(res)).toBe(true);
  expect(res).toHaveLength(3);
  for (const r of res) expect(r).toMatchObject({ error: { code: ErrorCode.InvalidRequest } });
});

test('B3: batch [null, valid] does not crash; correlates error + result', async () => {
  const res = (await handle([null, ok])) as unknown[];
  expect(res).toHaveLength(2);
  expect(res[0]).toMatchObject({ id: null, error: { code: ErrorCode.InvalidRequest } });
  expect(res[1]).toMatchObject({ id: 1, result: 'x' });
});

test('B2: id:null is a VALID id → response is produced (not treated as notification)', async () => {
  const res = await handle({ jsonrpc: '2.0', method: 'Svc.echo', params: 'x', id: null });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: null, result: 'x' });
});

test('B2: notification (valid structure, id absent) → no response', async () => {
  expect(await handle({ jsonrpc: '2.0', method: 'Svc.echo', params: 'x' })).toBeNull();
  // unknown method without id is still a notification — silence, not MethodNotFound
  expect(await handle({ jsonrpc: '2.0', method: 'Svc.nope', params: 'x' })).toBeNull();
});

test('B2: invalid Request without id → -32600 with id:null (spec §5 example {"method":1})', async () => {
  expect(await handle({ jsonrpc: '2.0', method: 1 })).toMatchObject({
    jsonrpc: '2.0',
    id: null,
    error: { code: ErrorCode.InvalidRequest },
  });
  expect(await handle({ jsonrpc: '2.0', method: 42 })).toMatchObject({ error: { code: ErrorCode.InvalidRequest } });
});

test('B2: void success carries the REQUIRED result member (null)', async () => {
  const res = (await handle({ jsonrpc: '2.0', method: 'Svc.noop', id: 7 })) as Record<string, unknown>;
  expect('result' in res).toBe(true);
  expect(res.result).toBeNull();
});

test('B2: wire error object has no non-standard status member', async () => {
  const guarded = jsonrpc(compose({ Svc }, { inject: {}, use: async () => { throw new RpcError(-32000, 'denied', undefined, 403); } }));
  const res = (await guarded.message.handle({ jsonrpc: '2.0', method: 'Svc.echo', params: 'x', id: 1 })) as { error: Record<string, unknown> };
  expect(res.error.code).toBe(-32000);
  expect('status' in res.error).toBe(false);
});

test('H2: rpc.discover goes through composer middleware (blocking guard denies it)', async () => {
  const deny: Middleware = async () => {
    throw RpcError.serverError('denied');
  };
  const guarded = jsonrpc(compose({ Svc }, { inject: {}, use: deny }));
  const res = await guarded.message.handle({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 });
  expect(res).toMatchObject({ id: 1, error: { code: -32000, message: 'denied' } });
  // ordinary call is denied too (sanity)
  expect(await guarded.message.handle(ok)).toMatchObject({ error: { code: -32000 } });
});

test('H2: rpc.discover without a guard still serves the OpenRPC document', async () => {
  const res = (await handle({ jsonrpc: '2.0', method: 'rpc.discover', id: 2 })) as { result: { openrpc: string } };
  expect(res.result.openrpc).toBe('1.3.2');
});
