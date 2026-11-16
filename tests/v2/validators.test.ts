import { expect, test } from 'vitest';
import * as v from 'valibot';
import { type } from 'arktype';
import * as Yup from 'yup';
import { fn, toRPC, ErrorCode } from '../../src';
import { yup } from '../../src/validators/yup';

// Native `~standard` — no adapter.
class ValibotSvc {
  constructor() {}

  static $greet = fn({ in: v.string(), out: v.string() });
  greet: typeof ValibotSvc.$greet.fn = async (name) => `Hi ${name}`;
}

// Native `~standard` — no adapter.
class ArkTypeSvc {
  constructor() {}

  static $add = fn({ in: type({ a: 'number', b: 'number' }), out: type('number') });
  add: typeof ArkTypeSvc.$add.fn = async (x) => x.a + x.b;
}

// yup has no `~standard` → shim adapter.
class YupSvc {
  constructor() {}

  static $greet = fn({ in: yup(Yup.string().strict()), out: yup(Yup.string().strict()) });
  greet: typeof YupSvc.$greet.fn = async (name) => `Hey ${name}`;
}

test('valibot (native): valid round-trip and invalid input', async () => {
  const c = toRPC({ ValibotSvc }, { inject: {} });

  const ok = await c.exec({ method: 'ValibotSvc.greet', params: 'Ada', id: 1 });
  expect(ok).toEqual({ jsonrpc: '2.0', id: 1, result: 'Hi Ada' });

  const bad = await c.exec({ method: 'ValibotSvc.greet', params: 42, id: 2 });
  expect(bad).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: ErrorCode.InvalidParams } });
});

test('arktype (native): object input round-trip', async () => {
  const c = toRPC({ ArkTypeSvc }, { inject: {} });
  const ok = await c.exec({ method: 'ArkTypeSvc.add', params: { a: 1, b: 2 }, id: 1 });
  expect(ok).toEqual({ jsonrpc: '2.0', id: 1, result: 3 });
});

test('yup (shim): valid round-trip and invalid input', async () => {
  const c = toRPC({ YupSvc }, { inject: {} });

  const ok = await c.exec({ method: 'YupSvc.greet', params: 'Bob', id: 1 });
  expect(ok).toEqual({ jsonrpc: '2.0', id: 1, result: 'Hey Bob' });

  const bad = await c.exec({ method: 'YupSvc.greet', params: 42, id: 2 });
  expect(bad).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: ErrorCode.InvalidParams } });
});