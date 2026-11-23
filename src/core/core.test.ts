import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { fn, compose, paramNames, CoreError, type Middleware } from '../index';
import { get } from '@/rest';
import { envelope } from '../test-utils';

// Класс без явного конструктора: первая скобка в toString — из fn(, не из constructor.
class NoCtor {
  static $ping = fn({ in: z.unknown(), out: z.string() });
  ping: typeof NoCtor.$ping.fn = async () => 'pong';
}

test('paramNames: class without constructor → no deps, call works', async () => {
  expect(paramNames(NoCtor)).toEqual([]);
  const composer = compose({ NoCtor });
  expect(await composer.call('NoCtor.ping', undefined)).toBe('pong');
});

// Нативные ошибки: свои сбои core — CoreError (протокол-нейтральная), ошибки обработчика как есть.
class Native {
  static $num = fn({ in: z.number(), out: z.number() });
  num: typeof Native.$num.fn = async (n) => n;

  static $boom = fn({ in: z.unknown() });
  boom: typeof Native.$boom.fn = async () => {
    throw new Error('handler failed');
  };
}

test('call returns the value and throws CoreError for pipeline failures', async () => {
  const composer = compose({ Native });
  expect(await composer.call('Native.num', 7)).toBe(7);
  await expect(composer.call('Native.nope', null)).rejects.toBeInstanceOf(CoreError);
  await expect(composer.call('Native.nope', null)).rejects.toMatchObject({ kind: 'not-found' });
  await expect(composer.call('Native.num', 'x')).rejects.toMatchObject({
    kind: 'invalid-params',
    message: 'Validation error',
  });
});

test('handler errors propagate untouched (no wrapping in core)', async () => {
  const composer = compose({ Native });
  await expect(composer.call('Native.boom', null)).rejects.toThrow('handler failed');
  await expect(composer.call('Native.boom', null)).rejects.not.toBeInstanceOf(CoreError);
});

// Скалярный вход: голый скаляр (chord-клиент) и стандартная by-position форма [value]
// (JSON-RPC §4.2, clef/стандартные клиенты) — обе принимаются.
test('scalar input: bare value and by-position [value] both accepted', async () => {
  const composer = compose({ Native });
  expect(await composer.call('Native.num', 7)).toBe(7);
  expect(await composer.call('Native.num', [7])).toBe(7);
  await expect(composer.call('Native.num', ['x'])).rejects.toMatchObject({ kind: 'invalid-params' });
  await expect(composer.call('Native.num', 'x')).rejects.toMatchObject({ kind: 'invalid-params' });
});

// Array-вход — позиционные аргументы обработчика (by-position), валидация поэлементная.
class Positional {
  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat: typeof Positional.$repeat.fn = async (text, times) => text.repeat(times);

  static $pad = fn({ in: z.tuple([z.string(), z.number(), z.string().optional()]), out: z.string() });
  pad: typeof Positional.$pad.fn = async (text, width, fill) => text.padStart(width, fill ?? ' ');
}

test('tuple input: positional handler args, optional tail, per-element validation', async () => {
  const composer = compose({ Positional });
  expect(await composer.call('Positional.repeat', ['ab', 3])).toBe('ababab');
  expect(await composer.call('Positional.pad', ['7', 3, '0'])).toBe('007');
  expect(await composer.call('Positional.pad', ['7', 3])).toBe('  7');
  await expect(composer.call('Positional.repeat', ['ab', 'x'])).rejects.toMatchObject({ kind: 'invalid-params' });
});

// Обычный массив — одиночное значение (не variadic): канонический провод [[…]],
// обработчик получает массив целиком. Голый массив params — позиционные аргументы.
class Lists {
  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll: typeof Lists.$sumAll.fn = async (nums) => nums.reduce((a, b) => a + b, 0);
}

test('array input is a single value: canonical wire [[…]]', async () => {
  const composer = compose({ Lists });
  expect(await composer.call('Lists.sumAll', [[1, 2, 3]])).toBe(6);
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
  compose({ Broken });
  expect(spy).toHaveBeenCalledWith(expect.stringContaining('Broken.ghost'));
  spy.mockRestore();
});

test('compose rejects mixing REST and RPC styles in one class', () => {
  class Mixed {
    constructor() {}
    static $item = get('/items', { resp: { 200: z.object({}) } });
    item: typeof Mixed.$item.fn = async () => ({});
    static $count = fn({ in: z.number(), out: z.number() });
    count: typeof Mixed.$count.fn = async (n) => n + 1;
  }
  expect(() => compose({ Mixed })).toThrow(/mixes REST/);
});

test('compose accepts separate REST and RPC classes', () => {
  class Rest {
    constructor() {}
    static $item = get('/items', { resp: { 200: z.object({}) } });
    item: typeof Rest.$item.fn = async () => ({});
  }
  class Rpc {
    constructor() {}
    static $count = fn({ in: z.number(), out: z.number() });
    count: typeof Rpc.$count.fn = async (n) => n + 1;
  }
  expect(() => compose({ Rest, Rpc })).not.toThrow();
});