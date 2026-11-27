import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose } from '../index';
import { get, post } from '@/rest';
import { agentTools } from '@/tools';
import { ZodAdapter } from '../schemas/zod';

class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

class Catalog {
  constructor() {}
  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string() }) },
    desc: 'Получить предмет',
  });
  getItem: typeof Catalog.$getItem.fn = async () => ({ id: 'x' });
}

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });
const tools = agentTools(composer);

test('agentTools: fn scalar tool — invoke/func/schema', async () => {
  const count = tools.find((t) => t.name === 'Math.count')!;
  expect(count.description).toBe('Инкремент');
  expect(await count.invoke({ value: 41 })).toBe(42);
  expect(await count.func({ value: 41 })).toBe('42');
  expect(await count.schema['~standard'].validate({ value: 5 })).toEqual({ value: { value: 5 } });
});

test('agentTools: REST tool — flat vendor schema with auto-path, invoke ok', async () => {
  const getItem = tools.find((t) => t.name === 'Catalog.getItem')!;
  expect(await getItem.schema['~standard'].validate({ item_id: '7', q: 'x' })).toEqual({ value: { item_id: '7', q: 'x' } });
  expect(await getItem.invoke({ item_id: '7' })).toEqual({ id: 'x' });
});

test('review2: transform schema — framework validate + invoke applies the transform exactly once', async () => {
  class Measure {
    constructor() {}
    static $len = fn({ in: z.string().transform((s) => s.length), out: z.number() });
    len: typeof Measure.$len.fn = async (n) => n;
  }
  const c = compose({ Measure }, { inject: {}, schemas: new ZodAdapter() });
  const len = agentTools(c).find((t) => t.name === 'Measure.len')!;
  // фреймворк валидирует tool.schema (плоская форма {value}) и передаёт результат в invoke —
  // второй проход не должен применять transform повторно (иначе z.string() видит number и падает).
  const parsed = await len.schema['~standard'].validate({ value: 'abc' });
  expect('value' in parsed).toBe(true);
  expect(await len.invoke((parsed as { value: unknown }).value)).toBe(3);
  // прямой вызов с сырыми аргументами (плоская форма тула) тоже работает — валидация в core.call
  expect(await len.invoke({ value: 'abc' })).toBe(3);
});

test('C24: REST array-body tool — schema advertises body, invoke packs the body slot', async () => {
  class Batch {
    constructor() {}
    static $sum = post('/sum', { body: z.array(z.number()), resp: { 200: z.number() } });
    sum = Batch.$sum(async ({ body }) => body.reduce((a, b) => a + b, 0));
  }
  const c = compose({ Batch }, { inject: {}, schemas: new ZodAdapter() });
  const sum = agentTools(c).find((t) => t.name === 'Batch.sum')!;
  const parsed = await sum.schema['~standard'].validate({ body: [1, 2, 3] });
  expect('value' in parsed).toBe(true);
  expect(await sum.invoke({ body: [1, 2, 3] })).toBe(6);
});

test('C28: void handler — func returns "" (Promise<string> honored, not undefined)', async () => {
  class Void {
    constructor() {}
    static $ping = fn({ in: z.void(), out: z.void() });
    ping: typeof Void.$ping.fn = async () => {};
  }
  const c = compose({ Void }, { inject: {}, schemas: new ZodAdapter() });
  const ping = agentTools(c).find((t) => t.name === 'Void.ping')!;
  expect(await ping.func({})).toBe('');
});

test('agentTools: stream-эндпоинты не тулы (unary only)', () => {
  class Ticker {
    constructor() {}
    static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
    countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
      yield { n: from };
    };
  }
  const c = compose({ Math, Ticker }, { inject: {}, schemas: new ZodAdapter() });
  const names = agentTools(c).map((t) => t.name);
  expect(names).toContain('Math.count');
  expect(names).not.toContain('Ticker.countdown');
});