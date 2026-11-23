import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose } from '../index';
import { get } from '@/rest';
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