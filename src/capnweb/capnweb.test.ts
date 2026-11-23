import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose } from '../index';
import { capnweb, capability } from '@/capnweb';

class Counter {
  #v = 0;
  static $inc = fn({ in: z.void(), out: z.number() });
  inc: typeof Counter.$inc.fn = async () => ++this.#v;
}

class Catalog {
  constructor() {}
  static $counter = fn({ in: z.void(), out: capability(Counter) });
  counter: typeof Catalog.$counter.fn = async () => new Counter();
}

const composer = compose({ Catalog }, { inject: {} });

test('capnweb: capability resolve, release, dispose', async () => {
  const session = capnweb(composer);

  const [cap] = await session.resolve([{ from: null, steps: [{ get: 'Catalog' }, { call: 'counter', args: [] }] }]);
  expect(cap).toEqual({ $cap: 0 });

  const [one] = await session.resolve([{ from: 0, steps: [{ call: 'inc', args: [] }] }]);
  expect(one).toBe(1);
  const [two] = await session.resolve([{ from: 0, steps: [{ call: 'inc', args: [] }] }]);
  expect(two).toBe(2); // тот же инстанс

  session.release(0);
  await expect(session.resolve([{ from: 0, steps: [{ call: 'inc', args: [] }] }])).rejects.toThrow('capability released');

  session.dispose();
  await expect(session.resolve([])).rejects.toThrow('disposed');
});

test('capnweb: проекции message/http поверх сессии', async () => {
  const batch = [{ from: null, steps: [{ get: 'Catalog' }, { call: 'counter', args: [] }] }];

  const s1 = capnweb(composer);
  expect(await s1.message.handle(batch)).toEqual([{ $cap: 0 }]);

  const s2 = capnweb(composer);
  const res = await s2.http.handle({ method: 'POST', url: 'http://localhost/capnweb', body: batch });
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ $cap: 0 }]);
});