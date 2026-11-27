// Регрессии раунда 4: OpenAPI успешный ответ без resp (#16), MCP-подсказки/outputSchema/имена
// и санитизация ошибок моста (#15).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose, RpcError } from '../index';
import { get, post, openapi } from '@/rest';
import { mcpTools } from '../generate';
import { registerMcpTools } from '../mcp/vercel';
import { ZodAdapter } from '../schemas/zod';

test('#16: OpenAPI advertises the success response even without a resp map', () => {
  class C {
    static $create = post('/things', { status: 201 });
    create = C.$create(async () => ({ id: '1' }));
  }
  const doc = openapi(compose({ C }, { schemas: new ZodAdapter() })).document as {
    paths: Record<string, { post: { responses: Record<string, unknown> } }>;
  };
  expect(doc.paths['/things'].post.responses['201']).toBeDefined();
});

test('#15: REST verb hints — POST is destructive, GET is read-only/non-destructive', () => {
  class R {
    static $remove = post('/users/{id}/remove', {});
    remove = R.$remove(async () => ({}));
    static $list = get('/users', {});
    list = R.$list(async () => []);
  }
  const tools = mcpTools(compose({ R }, { schemas: new ZodAdapter() })).document.tools as Array<{
    name: string;
    annotations: Record<string, boolean>;
  }>;
  expect(tools.find((t) => t.name === 'R_remove')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(tools.find((t) => t.name === 'R_list')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
});

test('#15: default tool names use underscore; scalar outputSchema is omitted (must be object)', () => {
  class S {
    static $count = fn({ in: z.number(), out: z.string() });
    count = S.$count(async (n) => String(n));
  }
  const tools = mcpTools(compose({ S }, { schemas: new ZodAdapter() })).document.tools as Array<{
    name: string;
    outputSchema?: unknown;
  }>;
  const count = tools.find((t) => t.name === 'S_count')!;
  expect(count).toBeDefined();
  expect(count.outputSchema).toBeUndefined();
});

interface Registered {
  name: string;
  handler: (args: unknown, ctx: { http?: { req?: Request } }) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}
function fakeServer() {
  const registered: Registered[] = [];
  return {
    registered,
    registerTool(name: string, _config: unknown, handler: Registered['handler']) {
      registered.push({ name, handler });
    },
  };
}

test('#15: bridge sanitizes unexpected handler errors, keeps intentional RpcError messages', async () => {
  class T {
    static $boom = fn({ in: z.void(), out: z.string(), mcp: {} });
    boom = T.$boom(async () => {
      throw new Error('connection to db-host-1 failed: password=secret');
    });
    static $deny = fn({ in: z.void(), out: z.string(), mcp: {} });
    deny = T.$deny(async () => {
      throw RpcError.serverError('Denied by policy');
    });
  }
  const server = fakeServer();
  registerMcpTools(server, compose({ T }, { schemas: new ZodAdapter() }));
  const boom = server.registered.find((r) => r.name === 'T_boom')!;
  const res = await boom.handler({}, { http: {} });
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toBe('Internal error');
  const deny = server.registered.find((r) => r.name === 'T_deny')!;
  expect((await deny.handler({}, { http: {} })).content[0].text).toBe('Denied by policy');
});
