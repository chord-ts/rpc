import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, ErrorCode, RpcError, type Middleware } from '../index';
import { envelope } from '../test-utils';

class Calc {
  constructor() {}

  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Calc.$add.fn = async (x) => x.a + x.b;

  static $echo = fn({ in: z.string(), out: z.string() });
  echo: typeof Calc.$echo.fn = async (s) => s;

  static $length = fn({ in: z.string(), out: z.number() });
  length: typeof Calc.$length.fn = async (s) => s.length;

  static $boom = fn({ in: z.unknown(), out: z.unknown() });
  boom: typeof Calc.$boom.fn = async () => {
    throw new Error('boom');
  };

  static $bad = fn({ in: z.unknown(), out: z.string() });
  bad: typeof Calc.$bad.fn = async () => 42 as unknown as string;
}

const exec = envelope({ Calc }, { inject: {} });

test('exec single request returns a JSON-RPC result', async () => {
  const res = await exec({ method: 'Calc.add', params: { a: 1, b: 2 }, id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 3 });
});

test('exec notification produces no response', async () => {
  const res = await exec({ method: 'Calc.echo', params: 'x' });
  expect(res).toBeUndefined();
});

test('exec batch correlates by id and omits notifications', async () => {
  const res = await exec([
    { method: 'Calc.add', params: { a: 10, b: 20 }, id: 1 },
    { method: 'Calc.echo', params: 'hi' },
    { method: 'Calc.length', params: 'abc', id: 'second' },
  ]);
  expect(res).toEqual([
    { jsonrpc: '2.0', id: 1, result: 30 },
    { jsonrpc: '2.0', id: 'second', result: 3 },
  ]);
});

test('unknown method → MethodNotFound', async () => {
  const res = await exec({ method: 'Calc.nope', id: 1 });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: ErrorCode.MethodNotFound } });
});

test('input validation failure → InvalidParams with issues', async () => {
  const res = await exec({ method: 'Calc.length', params: 42, id: 1 });
  expect(res).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InvalidParams, message: 'Validation error' },
  });
  expect((res as { error: { data: unknown[] } }).error.data).toHaveLength(1);
});

test('handler throw → InternalError with the thrown message', async () => {
  const res = await exec({ method: 'Calc.boom', id: 1 });
  expect(res).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InternalError, message: 'boom' },
  });
});

test('out validation is opt-in: off by default, on with validateOut', async () => {
  // По умолчанию out не валидируется — битый возврат проходит как есть.
  const off = await exec({ method: 'Calc.bad', id: 1 });
  expect(off).toEqual({ jsonrpc: '2.0', id: 1, result: 42 });

  // С флагом validateOut — битый возврат → InternalError.
  const validated = envelope({ Calc }, { inject: {}, validateOut: true });
  const on = await validated({ method: 'Calc.bad', id: 1 });
  expect(on).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InternalError, message: 'Response validation error' },
  });
});

test('middlewares run composer-level before per-fn, onion around the handler', async () => {
  const log: string[] = [];
  const composerMW: Middleware = async (_ctx, next) => {
    log.push('composer:before');
    const r = await next(_ctx);
    log.push('composer:after');
    return r;
  };
  const fnMW: Middleware = async (_ctx, next) => {
    log.push('fn:before');
    const r = await next(_ctx);
    log.push('fn:after');
    return r;
  };

  class Svc {
    constructor() {}
    static $m = fn({ in: z.unknown(), out: z.string(), use: fnMW });
    m: typeof Svc.$m.fn = async () => {
      log.push('handler');
      return 'ok';
    };
  }

  const exec = envelope({ Svc }, { inject: {}, use: composerMW });
  const res = await exec({ method: 'Svc.m', id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'ok' });
  expect(log).toEqual(['composer:before', 'fn:before', 'handler', 'fn:after', 'composer:after']);
});

test('middleware early throw short-circuits without calling the handler', async () => {
  const log: string[] = [];
  const guard: Middleware = async () => {
    throw new RpcError(-32000, 'denied');
  };

  class Guarded {
    constructor() {}
    static $m = fn({ in: z.unknown(), out: z.string(), use: guard });
    m: typeof Guarded.$m.fn = async () => {
      log.push('handler');
      return 'ok';
    };
  }

  const exec = envelope({ Guarded }, { inject: {} });
  const res = await exec({ method: 'Guarded.m', id: 1 });
  expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'denied' } });
  expect(log).toEqual([]);
});

test('middleware ctx mutation is visible to injected dependencies', async () => {
  type ReqCtx = { user?: string };

  class NeedsCtx {
    constructor(public readonly req: ReqCtx) {}
    static $who = fn({ in: z.unknown(), out: z.unknown() });
    who: typeof NeedsCtx.$who.fn = async () => this.req.user ?? null;
  }

  const enrich: Middleware = async (ctx, next) => {
    (ctx as ReqCtx).user = 'alice';
    return next(ctx);
  };

  const exec = envelope({ NeedsCtx }, { inject: { req: (ctx: ReqCtx) => ctx }, use: enrich });
  const res = await exec({ method: 'NeedsCtx.who', id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'alice' });
});