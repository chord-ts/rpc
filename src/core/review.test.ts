// Регрессии по ревью: B6 (схема-массив) и H1 (middleware вокруг stream).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose, type Middleware } from '../index';
import { ZodAdapter } from '../schemas/zod';

class Arrays {
  static $sum = fn({ in: z.array(z.number()), out: z.number() });
  sum = Arrays.$sum(async (nums) => nums.reduce((a, b) => a + b, 0));

  static $pair = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  pair = Arrays.$pair(async (s, n) => s.repeat(n));
}

test('B6: bare array params reach an array-schema handler as ONE argument (standard client)', async () => {
  const c = compose({ Arrays }, { schemas: new ZodAdapter() });
  expect(await c.call('Arrays.sum', [1, 2, 3])).toBe(6);
  expect(await c.call('Arrays.sum', [[1, 2, 3]])).toBe(6); // chord-клиент ([[…]]) тоже работает
});

test('B6: classification works without a registered adapter (zod ~standard converter)', async () => {
  const c = compose({ Arrays });
  expect(await c.call('Arrays.sum', [1, 2, 3])).toBe(6);
});

test('B6: tuple params stay positional', async () => {
  const c = compose({ Arrays }, { schemas: new ZodAdapter() });
  expect(await c.call('Arrays.pair', ['ab', 3])).toBe('ababab');
});

test('H1: composer middleware guards a stream (denial before any event)', async () => {
  const deny: Middleware = async () => {
    throw new Error('denied');
  };
  class Ticker {
    static $count = stream({ in: z.void(), event: z.number() });
    count = Ticker.$count(async function* () {
      yield 1;
    });
  }
  const guarded = compose({ Ticker }, { use: deny });
  const it = guarded.stream('Ticker.count', undefined)[Symbol.asyncIterator]();
  await expect(it.next()).rejects.toThrow('denied');
});

test('H1: per-stream use middleware runs around the iterable', async () => {
  const log: string[] = [];
  const mw: Middleware = async (ctx, next) => {
    log.push('before');
    const r = await next(ctx);
    log.push('after');
    return r;
  };
  class Ticker {
    static $count = stream({ in: z.void(), event: z.number(), use: mw });
    count = Ticker.$count(async function* () {
      yield 1;
      yield 2;
    });
  }
  const c = compose({ Ticker });
  const events: unknown[] = [];
  for await (const e of c.stream('Ticker.count', undefined)) events.push(e);
  expect(events).toEqual([1, 2]);
  expect(log).toEqual(['before', 'after']);
});
