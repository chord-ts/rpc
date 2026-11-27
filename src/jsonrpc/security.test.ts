// Security review: #6 (invalid-output не утекает наружу) и #8 (лимиты batch — размер и concurrency).

import { expect, test } from 'vitest';
import { z } from 'zod';
import * as v from 'valibot';
import { compose, fn } from '../index';
import { jsonrpc } from './index';

const call = (method: string, params: unknown, id: number) => ({ jsonrpc: '2.0', method, params, id });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- #6: invalid-output → ответ без data, весь объект (включая поля вне схемы) не утекает ---

test('#6: invalid-output strips data; secret field never reaches the wire', async () => {
  let calls = 0;
  class Leak {
    static $get = fn({ in: z.void(), out: v.object({ name: v.string() }) });
    get = Leak.$get(async () => {
      calls += 1;
      return { name: 1, passwordHash: 'SECRET' } as unknown as { name: string };
    });
  }
  const api = jsonrpc(compose({ Leak }, { validateOut: true }));
  const res = (await api.message.handle(call('Leak.get', undefined, 1))) as { error: { code: number; message: string; data?: unknown } };
  expect(calls).toBe(1); // обработчик выполнился, валидация выхода — после
  expect(res.error.code).toBe(-32603);
  expect(res.error.message).toBe('Response validation error');
  expect(res.error.data).toBeUndefined();
  expect(JSON.stringify(res)).not.toContain('SECRET');
});

// --- #8: лимиты batch ---

let calls = 0;
let active = 0;
let maxActive = 0;
class Work {
  static $echo = fn({ in: z.object({ n: z.number() }), out: z.number() });
  echo = Work.$echo(async ({ n }) => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active -= 1;
    return n;
  });
}
const work = () => compose({ Work });

test('#8: batch over maxBatch → single -32600 before dispatch, 0 handler calls', async () => {
  calls = 0;
  const api = jsonrpc(work(), { maxBatch: 3 });
  const batch = [1, 2, 3, 4].map((n) => call('Work.echo', { n }, n));
  const res = (await api.message.handle(batch)) as { id: null; error: { code: number; message: string } };
  expect(calls).toBe(0);
  expect(Array.isArray(res)).toBe(false);
  expect(res.error.code).toBe(-32600);
  expect(res.error.message).toBe('Batch too large');
});

test('#8: default maxBatch is 100 (101 rejected, 100 accepted)', async () => {
  calls = 0;
  const api = jsonrpc(work());
  const over = Array.from({ length: 101 }, (_, i) => call('Work.echo', { n: i }, i + 1));
  const rejected = (await api.message.handle(over)) as { error: { code: number } };
  expect(rejected.error.code).toBe(-32600);
  expect(calls).toBe(0);
  const ok = Array.from({ length: 100 }, (_, i) => call('Work.echo', { n: i }, i + 1));
  const res = (await api.message.handle(ok)) as unknown[];
  expect(res.length).toBe(100);
  expect(calls).toBe(100);
});

test('#8: concurrency cap limits in-flight methods; request order preserved', async () => {
  calls = 0; active = 0; maxActive = 0;
  const api = jsonrpc(work(), { concurrency: 2 });
  const batch = Array.from({ length: 6 }, (_, i) => call('Work.echo', { n: i }, i + 1));
  const res = (await api.message.handle(batch)) as { id: number; result: number }[];
  expect(maxActive).toBeLessThanOrEqual(2);
  expect(calls).toBe(6);
  expect(res.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(res.map((r) => r.result)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('#8: Infinity disables both limits', async () => {
  calls = 0; active = 0; maxActive = 0;
  const api = jsonrpc(work(), { maxBatch: Infinity, concurrency: Infinity });
  const batch = Array.from({ length: 150 }, (_, i) => call('Work.echo', { n: i }, i + 1));
  const res = (await api.message.handle(batch)) as unknown[];
  expect(res.length).toBe(150);
  expect(calls).toBe(150);
  expect(maxActive).toBeGreaterThan(2); // без пула все стартуют одновременно
});
