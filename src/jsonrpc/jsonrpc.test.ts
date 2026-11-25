import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose, jsonrpc, ErrorCode, RpcError, type Middleware } from '../index';
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

test('http projection: POST → JSON-RPC ответ без конверта транспорта', async () => {
  const api = jsonrpc(compose({ Calc }, { inject: {} }));
  const res = await api.http.handle({ method: 'POST', url: 'http://localhost/rpc', body: { jsonrpc: '2.0', method: 'Calc.add', params: { a: 1, b: 2 }, id: 1 } });
  expect(res.status).toBe(200);
  expect((res.body as any).result).toBe(3);
});

test('RpcError factories carry the spec codes and default messages', () => {
  expect(RpcError.parseError()).toMatchObject({ code: ErrorCode.ParseError, message: 'Parse error' });
  expect(RpcError.invalidRequest()).toMatchObject({ code: ErrorCode.InvalidRequest, message: 'Invalid request' });
  expect(RpcError.methodNotFound()).toMatchObject({ code: ErrorCode.MethodNotFound, message: 'Method not found' });
  expect(RpcError.invalidParams()).toMatchObject({ code: ErrorCode.InvalidParams, message: 'Invalid params' });
  expect(RpcError.internal()).toMatchObject({ code: ErrorCode.InternalError, message: 'Internal error' });
  expect(RpcError.serverError()).toMatchObject({ code: ErrorCode.ServerError, message: 'Server error' });
  expect(RpcError.parseError()).toBeInstanceOf(RpcError);
});

test('RpcError factories accept a custom message and data', () => {
  const e = RpcError.invalidParams('Expected a number', { field: 'a' });
  expect(e).toMatchObject({ code: ErrorCode.InvalidParams, message: 'Expected a number', data: { field: 'a' } });
});

test('factory error thrown by a handler keeps its code and data on the wire', async () => {
  class Guard {
    constructor() {}
    static $m = fn({ in: z.unknown(), out: z.unknown() });
    m: typeof Guard.$m.fn = async () => {
      throw RpcError.invalidParams('Expected a number', { field: 'a' });
    };
  }
  const exec = envelope({ Guard }, { inject: {} });
  const res = await exec({ method: 'Guard.m', id: 1 });
  expect(res).toEqual({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InvalidParams, message: 'Expected a number', data: { field: 'a' } },
  });
});

test('serverError factory keeps -32000 and data on the wire', async () => {
  class Calc {
    constructor() {}
    static $div = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
    div: typeof Calc.$div.fn = async ({ a, b }) => {
      if (b === 0) throw RpcError.serverError('Division by zero', { a, b });
      return a / b;
    };
  }
  const exec = envelope({ Calc }, { inject: {} });
  const res = await exec({ method: 'Calc.div', params: { a: 1, b: 0 }, id: 1 });
  expect(res).toEqual({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: 'Division by zero', data: { a: 1, b: 0 } },
  });
});