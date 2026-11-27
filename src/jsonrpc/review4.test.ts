// Регрессии раунда 4: граница jsonrpc-биндинга (#2), параллельный батч (#17).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, fn, jsonrpc } from '../index';
import { post } from '@/rest';
import { ZodAdapter } from '../schemas/zod';

class Admin {
  static $wipe = post('/wipe', {});
  wipe = Admin.$wipe(async () => 'wiped');
}
class Rpc {
  static $ping = fn({ in: z.void(), out: z.string() });
  ping = Rpc.$ping(async () => 'pong');
}

const core = compose({ Admin, Rpc });
const call = (method: string, params?: unknown) => ({ jsonrpc: '2.0', method, params, id: 1 });

test('#2: jsonrpc does not dispatch REST-declared methods by default', async () => {
  const api = jsonrpc(core);
  const res = (await api.message.handle(call('Admin.wipe'))) as { error?: { code: number } };
  expect(res.error?.code).toBe(-32601);
  // свой fn-эндпоинт работает
  const ok = (await api.message.handle(call('Rpc.ping'))) as { result?: unknown };
  expect(ok.result).toBe('pong');
});

test('#2: includeRest opens REST methods explicitly', async () => {
  const api = jsonrpc(core, { includeRest: true });
  const res = (await api.message.handle(call('Admin.wipe'))) as { result?: unknown };
  expect(res.result).toBe('wiped');
});

test('#17: batch dispatches concurrently and preserves request order', async () => {
  let active = 0;
  let maxActive = 0;
  class Slow {
    static $a = fn({ in: z.void(), out: z.string() });
    a = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return 'a';
    };
  }
  const api = jsonrpc(compose({ Slow }, { schemas: new ZodAdapter() }));
  const batch = [call('Slow.a'), { ...call('Slow.a'), id: 2 }, { ...call('Slow.a'), id: 3 }];
  const res = (await api.message.handle(batch)) as Array<{ id: number; result: unknown }>;
  expect(res.map((r) => r.id)).toEqual([1, 2, 3]); // порядок сохранён
  expect(res.every((r) => r.result === 'a')).toBe(true);
  expect(maxActive).toBeGreaterThan(1); // исполнялись параллельно, не по очереди
});
