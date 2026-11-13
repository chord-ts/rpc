import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, toRPC, ErrorCode } from '../../src/v2';
import { zod } from '../../src/v2/validators/zod';

class Profile {
  constructor() {}

  static $greet = fn({ in: zod(z.string()), out: zod(z.string()) });
  greet: typeof Profile.$greet.fn = (name) => `Hi ${name}`;

  static $create = fn({
    in: zod(z.object({ name: z.string(), age: z.number() })),
    out: zod(z.object({ id: z.string() })),
  });
  create: typeof Profile.$create.fn = (input) => ({ id: `${input.name}-${input.age}` });
}

const composer = toRPC({ Profile }, { inject: {} });

test('zod adapter wraps a schema into the ~standard contract', () => {
  const schema = zod(z.string());
  expect(schema['~standard'].version).toBe(1);
  expect(schema['~standard'].vendor).toBe('zod');
});

test('zod in/out: valid scalar round-trips', async () => {
  const res = await composer.exec({ method: 'Profile.greet', params: 'Ada', id: 1 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'Hi Ada' });
});

test('zod in: invalid input → InvalidParams with zod issues', async () => {
  const res = await composer.exec({ method: 'Profile.greet', params: 42, id: 1 });
  expect(res).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InvalidParams, message: 'Validation error' },
  });

  const issues = ((res as { error: { data: any[] } }).error.data);
  expect(issues.length).toBeGreaterThan(0);
  expect(issues[0]).toHaveProperty('message', 'Expected string, received number');
});

test('zod object input round-trips', async () => {
  const res = await composer.exec({ method: 'Profile.create', params: { name: 'x', age: 3 }, id: 2 });
  expect(res).toEqual({ jsonrpc: '2.0', id: 2, result: { id: 'x-3' } });
});

test('zod out: invalid output → InternalError', async () => {
  class Broken {
    constructor() {}
    static $m = fn({ in: zod(z.any()), out: zod(z.string()) });
    m: typeof Broken.$m.fn = () => 123 as unknown as string;
  }

  const c = toRPC({ Broken }, { inject: {} });
  const res = await c.exec({ method: 'Broken.m', id: 1 });
  expect(res).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ErrorCode.InternalError, message: 'Response validation error' },
  });
});