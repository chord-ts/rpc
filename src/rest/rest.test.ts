// Регрессии по ревью (B3/B4/B5/H3/H4 + средние 405/query-массивы/специфичность).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, RpcError, type TransportRequest } from '../index';
import { get, post, rest } from '@/rest';

class Users {
  static $promote = post('/users/{id}/promote', {});
  promote = Users.$promote(async ({ id }) => ({ id }));
}

class Pollute {
  static $ingest = post('/pollute', {});
  ingest = Pollute.$ingest(async (input) => ({
    own: Object.prototype.hasOwnProperty.call(input, 'isAdmin'),
    viaProto: (input as { isAdmin?: boolean }).isAdmin ?? null,
  }));
}

class Boom {
  static $fail = get('/fail', {});
  fail = Boom.$fail(async () => {
    throw new Error('connection to db-host-1 failed: password=secret');
  });
}

class Files {
  static $json = get('/items.json', {});
  json = Files.$json(async () => ({ ok: true }));
}

class OnlyPost {
  static $create = post('/things', {});
  create = OnlyPost.$create(async () => ({ ok: true }));
}

class Tags {
  static $list = get('/tags', { query: z.object({ tag: z.union([z.string(), z.array(z.string())]).optional() }) });
  list = Tags.$list(async ({ tag }) => ({ tag: tag ?? null }));
}

// Специфичность: статический /items/new должен выигрывать у /items/{id} независимо от порядка.
class Items {
  static $byId = get('/items/{id}', {});
  byId = Items.$byId(async ({ id }) => ({ which: 'id', id }));
  static $new = get('/items/new', {});
  new = Items.$new(async () => ({ which: 'new' }));
}

const api = rest(compose({ Users, Pollute, Boom, Files, OnlyPost, Tags, Items }));
const req = (method: string, path: string, body?: unknown): TransportRequest => ({
  method,
  url: `http://localhost${path}`,
  body,
});

test('B4: path param is authoritative — body cannot overwrite it', async () => {
  const res = await api.http.handle(req('POST', '/users/7/promote', { id: 'admin' }));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: '7' });
});

test('B5: __proto__ in body does not pollute handler input or Object.prototype', async () => {
  const body = JSON.parse('{"__proto__":{"isAdmin":true}}');
  const res = await api.http.handle(req('POST', '/pollute', body));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ own: false, viaProto: null });
  expect((Object.prototype as { isAdmin?: boolean }).isAdmin).toBeUndefined();
});

test('B3: malformed percent-encoding → 400, no crash', async () => {
  const res = await api.http.handle(req('GET', '/items/%E0%A4%A'));
  expect(res.status).toBe(400);
});

test('H3: unexpected handler error → generic detail, internal message not leaked', async () => {
  const res = await api.http.handle(req('GET', '/fail'));
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ detail: 'Internal error' });
  expect(JSON.stringify(res.body)).not.toContain('db-host-1');
});

test('H4: literal dot in template is escaped — /items.json does not match /itemsXjson', async () => {
  expect((await api.http.handle(req('GET', '/items.json'))).status).toBe(200);
  expect((await api.http.handle(req('GET', '/itemsXjson'))).status).toBe(404);
});

test('medium: wrong verb on an existing path → 405 (not 404)', async () => {
  const res = await api.http.handle(req('GET', '/things'));
  expect(res.status).toBe(405);
});

test('medium: repeated query key becomes an array; single stays a string', async () => {
  expect((await api.http.handle(req('GET', '/tags?tag=a&tag=b'))).body).toEqual({ tag: ['a', 'b'] });
  expect((await api.http.handle(req('GET', '/tags?tag=a'))).body).toEqual({ tag: 'a' });
});

test('medium: static route wins over param route by specificity', async () => {
  expect((await api.http.handle(req('GET', '/items/new'))).body).toEqual({ which: 'new' });
  expect((await api.http.handle(req('GET', '/items/42'))).body).toEqual({ which: 'id', id: '42' });
});

// --- Второй раунд ревью: схема-less срезы, issues в 422, статус обработчика, __proto__ в query ---

class Pay {
  static $charge = post('/pay', { body: z.object({ amount: z.number().positive() }) });
  charge = Pay.$charge(async (input) => input);
}

class Raw {
  static $ingest = post('/raw', {});
  ingest = Raw.$ingest(async (input) => input);
}

class Len {
  static $len = get('/len', { query: z.object({ length: z.string().optional() }) });
  len = Len.$len(async ({ length }) => ({ length: length ?? null }));
}

class Things {
  static $find = get('/things/{id}', {});
  find = Things.$find(async () => {
    throw new RpcError(-32001, 'Thing not found', undefined, 404);
  });
}

const api2 = rest(compose({ Pay, Raw, Len, Things }));

test('review2: schema-less query cannot overwrite a validated body field nor inject new ones', async () => {
  const res = await api2.http.handle(req('POST', '/pay?amount=-5&role=admin', { amount: 10 }));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ amount: 10 });
});

test('review2: schema-less body is not merged into the handler input at all', async () => {
  const res = await api2.http.handle(req('POST', '/raw', { anything: 'goes' }));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({});
});

test('review2: validation 422 carries the issues, not just a generic detail', async () => {
  const res = await api2.http.handle(req('POST', '/pay', { amount: -5 }));
  expect(res.status).toBe(422);
  const body = res.body as { detail: string; issues?: unknown[] };
  expect(body.detail).toBe('Validation error');
  expect(Array.isArray(body.issues)).toBe(true);
  expect(body.issues!.length).toBeGreaterThan(0);
});

test('review2: handler-declared HTTP status (RpcError.status) is honored', async () => {
  const res = await api2.http.handle(req('GET', '/things/7'));
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ detail: 'Thing not found' });
});

test('review2: __proto__ in query does not set the prototype (schema length stays unset)', async () => {
  const res = await api2.http.handle(req('GET', '/len?__proto__=a&__proto__=b'));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ length: null });
  expect((Object.prototype as { length?: unknown }).length).toBeUndefined();
});
