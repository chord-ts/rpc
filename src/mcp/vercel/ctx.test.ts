// Security review #1: MCP ctx-фабрика — граница авторизации. Async-фабрика ожидается до вызова
// метода; бросок или отсутствие HTTP-запроса → 0 вызовов обработчика, без unhandled rejection.

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose } from '../../index';
import { RpcError } from '../../jsonrpc';
import { ZodAdapter } from '../../schemas/zod';
import { fn, registerMcpTools } from './index';

let calls = 0;
class Guarded {
  static $secret = fn({ in: z.void(), out: z.string(), mcp: { name: 'secret' } });
  secret = Guarded.$secret(async () => {
    calls += 1;
    return this.user;
  });
  constructor(public user: string) {}
}

const makeCore = () =>
  compose({ Guarded }, { inject: { user: (ctx: { user?: string }) => ctx.user ?? 'anon' }, schemas: new ZodAdapter() });

function fakeServer() {
  const registered: { name: string; handler: (args: unknown, ctx: { http?: { req?: Request } }) => Promise<{ content: { text: string }[]; isError?: boolean }> }[] = [];
  return {
    registered,
    registerTool(name: string, _config: unknown, handler: (args: unknown, ctx: { http?: { req?: Request } }) => Promise<{ content: { text: string }[]; isError?: boolean }>) {
      registered.push({ name, handler });
    },
  };
}

const req = () => new Request('http://localhost');

test('#1: async ctx factory throws → 0 handler calls, isError, no unhandled rejection', async () => {
  calls = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const server = fakeServer();
  registerMcpTools(server, makeCore(), { ctx: async () => { throw RpcError.serverError('Unauthorized'); } });
  const res = await server.registered[0].handler({}, { http: { req: req() } });
  await new Promise((r) => setImmediate(r)); // дать отклонённому промису проявиться, если он не пойман
  process.off('unhandledRejection', onUnhandled);
  expect(calls).toBe(0);
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toBe('Unauthorized');
  expect(unhandled).toEqual([]);
});

test('#1: configured factory without an HTTP request → 0 handler calls, isError', async () => {
  calls = 0;
  const server = fakeServer();
  registerMcpTools(server, makeCore(), { ctx: async () => ({ user: 'ada' }) });
  const res = await server.registered[0].handler({}, {}); // ctx.http отсутствует
  expect(calls).toBe(0);
  expect(res.isError).toBe(true);
});

test('#1: async factory resolves → ctx reaches DI, handler runs exactly once', async () => {
  calls = 0;
  const server = fakeServer();
  registerMcpTools(server, makeCore(), {
    ctx: async () => { await Promise.resolve(); return { user: 'ada' }; },
  });
  const res = await server.registered[0].handler({}, { http: { req: req() } });
  expect(calls).toBe(1);
  expect(res.isError).toBeUndefined();
  expect(res.content[0].text).toBe('ada');
});
