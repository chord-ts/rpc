// Регрессии раунда 4: коллизии body×query (#4), branded-ошибки (#5), array-query (#7),
// ReDoS роутера (#18), basePath (#21), null-body (#24), HEAD (#22).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, RpcError, type TransportRequest } from '../index';
import { get, post, rest, HttpError } from '@/rest';

const req = (method: string, path: string, body?: unknown): TransportRequest => ({
  method,
  url: `http://localhost${path}`,
  body,
});

test('#4: a query key colliding with a validated body field is rejected (422)', async () => {
  class Charge {
    static $charge = post('/charge', {
      body: z.object({ amount: z.number().positive() }),
      query: z.looseObject({ ref: z.string().optional() }),
    });
    charge = Charge.$charge(async ({ amount }: { amount: number }) => ({ amount }));
  }
  const api = rest(compose({ Charge }));
  // looseObject пропускает лишний amount из query — он не должен перетереть проверенное body
  const res = await api.http.handle(req('POST', '/charge?amount=-5', { amount: 10 }));
  expect(res.status).toBe(422);
  // без коллизии — обработчик получает проверенное body-значение
  const ok = await api.http.handle(req('POST', '/charge?ref=x', { amount: 10 }));
  expect(ok.status).toBe(200);
  expect(ok.body).toEqual({ amount: 10 });
});

test('#5: HttpError carries status and data as the response body', async () => {
  class Dup {
    static $create = post('/dup', {});
    create = Dup.$create(async () => {
      throw new HttpError(409, 'Conflict', { code: 'DUP', retryAfter: 5 });
    });
  }
  const api = rest(compose({ Dup }));
  const res = await api.http.handle(req('POST', '/dup'));
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ code: 'DUP', retryAfter: 5 });
});

test('#5: RpcError.status still honored, data is the body', async () => {
  class E {
    static $x = post('/x', {});
    x = E.$x(async () => {
      throw new RpcError(-32000, 'Conflict', { code: 'DUP' }, 409);
    });
  }
  const res = await rest(compose({ E })).http.handle(req('POST', '/x'));
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ code: 'DUP' });
});

test('#5: a foreign Error+status does not leak its message/status', async () => {
  class Leak {
    static $call = post('/call', {});
    call = Leak.$call(async () => {
      throw Object.assign(new Error('Incorrect API key provided: sk-live-secret'), { status: 401 });
    });
  }
  const res = await rest(compose({ Leak })).http.handle(req('POST', '/call'));
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ detail: 'Internal error' });
});

test('#7: declared array query fields round-trip (single, repeated, empty)', async () => {
  class List {
    static $list = get('/list', { query: z.object({ tag: z.array(z.string()) }) });
    list = List.$list(async ({ tag }: { tag: string[] }) => ({ tag }));
  }
  const api = rest(compose({ List }));
  expect((await api.http.handle(req('GET', '/list?tag=a'))).body).toEqual({ tag: ['a'] });
  expect((await api.http.handle(req('GET', '/list?tag=a&tag=b'))).body).toEqual({ tag: ['a', 'b'] });
  expect((await api.http.handle(req('GET', '/list'))).body).toEqual({ tag: [] });
});

test('#18: multiple placeholders per segment match in linear time (no ReDoS)', async () => {
  class F {
    static $f = get('/f/{a}-{b}-{c}', {});
    f = F.$f(async ({ a, b, c }: { a: string; b: string; c: string }) => ({ a, b, c }));
  }
  const api = rest(compose({ F }));
  const ok = await api.http.handle(req('GET', '/f/x-y-z'));
  expect(ok.body).toEqual({ a: 'x', b: 'y', c: 'z' });
  // длинный несовпадающий путь не должен вызывать катастрофический бэктрекинг
  const long = `/f/${'x'.repeat(20000)}`;
  const t0 = performance.now();
  const res = await api.http.handle(req('GET', long));
  expect(performance.now() - t0).toBeLessThan(500);
  expect(res.status).toBe(404);
});

test('#21: basePath strips the mount prefix before routing', async () => {
  class Items {
    static $byId = get('/items/{id}', {});
    byId = Items.$byId(async ({ id }: { id: string }) => ({ id }));
  }
  const api = rest(compose({ Items }), { basePath: '/api' });
  expect((await api.http.handle(req('GET', '/api/items/7'))).body).toEqual({ id: '7' });
  expect((await api.http.handle(req('GET', '/items/7'))).status).toBe(404);
});

test('#24: an explicit null body is preserved (z.null())', async () => {
  class N {
    static $n = post('/n', { body: z.null() });
    n = N.$n(async (input: unknown) => input);
  }
  const res = await rest(compose({ N })).http.handle(req('POST', '/n', null));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ body: null });
});

test('#22: HEAD shares GET routing', async () => {
  class H {
    static $g = get('/g', {});
    g = H.$g(async () => ({ ok: true }));
  }
  const res = await rest(compose({ H })).http.handle(req('HEAD', '/g'));
  expect(res.status).toBe(200);
});
