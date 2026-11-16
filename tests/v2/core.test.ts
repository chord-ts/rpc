import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { fn, compose, paramNames, type Middleware } from '../../src';
import { envelope } from './rpc';

// Класс без явного конструктора: первая скобка в toString — из fn(, не из constructor.
class NoCtor {
  static $ping = fn({ in: z.unknown(), out: z.string() });
  ping: typeof NoCtor.$ping.fn = async () => 'pong';
}

test('paramNames: class without constructor → no deps, call works', async () => {
  expect(paramNames(NoCtor)).toEqual([]);
  const composer = compose({ NoCtor }, { inject: {} });
  expect(await composer.call('NoCtor.ping', undefined)).toEqual({ ok: true, value: 'pong' });
});

test('paramNames: constructor located even after static fn fields', () => {
  class WithDeps {
    static $x = fn({ in: z.unknown() });
    constructor(public readonly a: unknown, public readonly b: unknown) {}
  }
  expect(paramNames(WithDeps)).toEqual(['a', 'b']);
});

// Изоляция ctx в batch: мутация middleware не протекает между элементами.
class Svc {
  constructor(public readonly ctx: { count?: number }) {}
  static $count = fn({ in: z.unknown(), out: z.number() });
  count: typeof Svc.$count.fn = async () => this.ctx.count ?? 0;
}
const bump: Middleware = async (ctx, next) => {
  const r = await next(ctx);
  const c = ctx as { count?: number };
  c.count = (c.count ?? 0) + 1; // мутация после вызова
  return r;
};

test('exec batch: ctx isolated per call (no mutation leak)', async () => {
  const exec = envelope({ Svc }, { inject: { ctx: (e: any) => e }, use: bump });
  const res = await exec([
    { method: 'Svc.count', id: 1 },
    { method: 'Svc.count', id: 2 },
  ]);
  // Каждый вызов получает свежий ctx → оба видят count=0 (без изоляции второй увидел бы 1).
  expect(res).toEqual([
    { jsonrpc: '2.0', id: 1, result: 0 },
    { jsonrpc: '2.0', id: 2, result: 0 },
  ]);
});

test('compose warns when a schema is declared without a handler', () => {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  class Broken {
    static $ghost = fn({ in: z.unknown(), out: z.unknown() });
    // обработчик ghost забыли
  }
  compose({ Broken }, { inject: {} });
  expect(spy).toHaveBeenCalledWith(expect.stringContaining('Broken.ghost'));
  spy.mockRestore();
});