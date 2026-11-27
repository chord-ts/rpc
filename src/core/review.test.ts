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

// --- Второй раунд ревью: проводные эвристики (1-кортеж, обёрнутый массив, simple-эндпоинты) ---

class One {
  static $one = fn({ in: z.tuple([z.string()]), out: z.string() });
  one = One.$one(async (s) => s);
}

class Bag {
  static $arr = fn({ in: z.array(z.unknown()), out: z.unknown() });
  arr = Bag.$arr(async (xs) => xs[0]);
}

class Simple {
  async echo(x: unknown) {
    return x;
  }
}

test('review2: 1-tuple accepts a bare scalar (positional [value] fallback)', async () => {
  const c = compose({ One }, { schemas: new ZodAdapter() });
  expect(await c.call('One.one', 'a')).toBe('a'); // голый скаляр (chord-клиент)
  expect(await c.call('One.one', ['a'])).toBe('a'); // стандартный позиционный params
});

test('review2: array(unknown) — wrapped [[…]] delivers the inner array, not the wrapper', async () => {
  const c = compose({ Bag }, { schemas: new ZodAdapter() });
  expect(await c.call('Bag.arr', [['x']])).toBe('x'); // обёрнутая форма каноническая
  expect(await c.call('Bag.arr', ['x'])).toBe('x'); // голый массив тоже работает
  expect(await c.call('Bag.arr', [5])).toBe(5); // голый [5] — значение [5], не скаляр 5
});

test('review2: simple endpoint — positional [5] reaches echo(x) as 5, [[…]] as the array', async () => {
  const c = compose({ Simple });
  expect(await c.call('Simple.echo', [5])).toBe(5);
  expect(await c.call('Simple.echo', [[1, 2]])).toEqual([1, 2]);
  expect(await c.call('Simple.echo', 5)).toBe(5);
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
