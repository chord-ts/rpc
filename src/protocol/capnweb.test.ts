import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose, capnweb, capability } from '../index';

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