// Регрессии по ревью: B9 (OpenRPC $defs), H6 (MCP shipped-код), средний io (input/output).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose } from '../index';
import { openrpc } from '@/jsonrpc';
import { get, post, openapi } from '@/rest';
import { mcpTools } from '../generate';
import { registerMcpTools } from '../mcp/vercel';
import { ZodAdapter } from '../schemas/zod';

// --- B9: рекурсивная схема → $defs hoisted, все $ref резолвятся ---

type NodeT = { value: number; children: NodeT[] };
const Node: z.ZodType<NodeT> = z.lazy(() => z.object({ value: z.number(), children: z.array(Node) }));

class Tree {
  // reuse of Node in two fields → zod emits $defs/__schema0 with #/$defs refs (the B9 case).
  static $node = fn({ in: z.object({ label: z.string() }), out: z.object({ a: Node, b: Node }) });
  node = Tree.$node(async () => ({ a: { value: 1, children: [] }, b: { value: 2, children: [] } }));
}

function collectRefs(node: unknown, refs: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, refs);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string') refs.push(v);
      else collectRefs(v, refs);
    }
  }
}

test('B9: OpenRPC document has no dangling #/$defs refs; all refs resolve to components.schemas', () => {
  const doc = openrpc(compose({ Tree }, { schemas: new ZodAdapter() })).document as Record<string, unknown>;
  const refs: string[] = [];
  collectRefs(doc, refs);
  expect(refs.some((r) => r.startsWith('#/$defs/'))).toBe(false);
  const schemas = ((doc.components as Record<string, unknown>)?.schemas ?? {}) as Record<string, unknown>;
  expect(Object.keys(schemas).length).toBeGreaterThan(0);
  for (const r of refs) {
    if (r.startsWith('#/components/schemas/')) {
      expect(schemas[r.slice('#/components/schemas/'.length)]).toBeDefined();
    }
  }
});

// --- Второй раунд ревью: OpenAPI hoist + рекурсивный корень ($ref:'#') в обоих документах ---

class TreeRest {
  static $save = post('/tree', { body: z.object({ a: Node, b: Node }) });
  save = TreeRest.$save(async () => ({ ok: true }));
  static $put = post('/node', { body: Node });
  put = TreeRest.$put(async () => ({ ok: true }));
}

function expectNoDanglingRefs(doc: Record<string, unknown>): void {
  const refs: string[] = [];
  collectRefs(doc, refs);
  expect(refs).not.toContain('#');
  expect(refs.some((r) => r.startsWith('#/$defs/'))).toBe(false);
  const schemas = ((doc.components as Record<string, unknown>)?.schemas ?? {}) as Record<string, unknown>;
  for (const r of refs) {
    if (r.startsWith('#/components/schemas/')) {
      expect(schemas[r.slice('#/components/schemas/'.length)]).toBeDefined();
    }
  }
}

test('review2: OpenAPI hoists $defs into components.schemas — no dangling refs', () => {
  const doc = openapi(compose({ TreeRest }, { schemas: new ZodAdapter() })).document as Record<string, unknown>;
  expectNoDanglingRefs(doc);
  const schemas = ((doc.components as Record<string, unknown>)?.schemas ?? {}) as Record<string, unknown>;
  expect(Object.keys(schemas).length).toBeGreaterThan(0);
});

test('review2: recursive root ($ref:"#") is hoisted and rewritten in OpenRPC and OpenAPI', () => {
  class Rec {
    static $node = fn({ in: Node, out: z.object({ ok: z.boolean() }) });
    node = Rec.$node(async () => ({ ok: true }));
  }
  const openrpcDoc = openrpc(compose({ Rec }, { schemas: new ZodAdapter() })).document as Record<string, unknown>;
  expectNoDanglingRefs(openrpcDoc);
  const openapiDoc = openapi(compose({ TreeRest }, { schemas: new ZodAdapter() })).document as Record<string, unknown>;
  expectNoDanglingRefs(openapiDoc);
});

// --- H6: registerMcpTools уважает mcp.name, вызывает ядро по Service.method, схема из адаптера ---

class Media {
  static $thumb = fn({
    in: z.object({ id: z.string() }),
    out: z.object({ at: z.date() }),
    mcp: { name: 'thumbnail', title: 'Thumb' },
  });
  thumb = Media.$thumb(async () => ({ at: new Date('2026-01-01T00:00:00Z') }));

  static $ping = fn({ in: z.void(), out: z.string(), mcp: { name: 'ping' } });
  ping = Media.$ping(async () => 'pong');
}

interface Registered {
  name: string;
  config: { title?: string; inputSchema: { '~standard': { jsonSchema?: { output: (o: { target: string }) => unknown } } } };
  handler: (args: unknown, ctx: { http?: { req?: Request } }) => Promise<{ content: { text: string }[] }>;
}

function fakeServer() {
  const registered: Registered[] = [];
  return {
    registered,
    registerTool(name: string, config: Registered['config'], handler: Registered['handler']) {
      registered.push({ name, config, handler });
    },
  };
}

test('H6: tool registered under mcp.name; handler calls core by Service.method', async () => {
  const server = fakeServer();
  registerMcpTools(server, compose({ Media }, { schemas: new ZodAdapter() }));
  const names = server.registered.map((r) => r.name).sort();
  expect(names).toEqual(['ping', 'thumbnail']);

  const thumb = server.registered.find((r) => r.name === 'thumbnail')!;
  expect(thumb.config.title).toBe('Thumb');
  const res = await thumb.handler({ id: 'x' }, { http: {} });
  expect(res.content[0].text).toContain('2026-01-01');

  const ping = server.registered.find((r) => r.name === 'ping')!;
  expect((await ping.handler({}, { http: {} })).content[0].text).toBe('pong');
});

test('review2: void handler yields a valid text block (text is a string, not undefined)', async () => {
  class Done {
    static $done = fn({ in: z.void(), out: z.void(), mcp: { name: 'done' } });
    done = Done.$done(async () => {});
  }
  const server = fakeServer();
  registerMcpTools(server, compose({ Done }, { schemas: new ZodAdapter() }));
  const res = await server.registered[0].handler({}, { http: {} });
  expect(typeof res.content[0].text).toBe('string');
  expect(res.content[0].text).toBe('');
});

test('H6: advertised inputSchema jsonSchema does not throw on void/Date (adapter-softened)', () => {
  const server = fakeServer();
  registerMcpTools(server, compose({ Media }, { schemas: new ZodAdapter() }));
  for (const r of server.registered) {
    const conv = r.config.inputSchema['~standard'].jsonSchema;
    expect(conv).toBeDefined();
    expect(() => conv!.output({ target: 'draft-2020-12' })).not.toThrow();
  }
});

// --- средний io: input описывает .default() как необязательное, output — как обязательное ---

test('C17: mcpTools keeps user mcp.annotations; REST verbs fall back to spec hints', () => {
  class Ro {
    static $ro = fn({ in: z.void(), out: z.string(), mcp: { name: 'ro', annotations: { readOnlyHint: true, openWorldHint: false } } });
    ro = Ro.$ro(async () => 'x');
  }
  class List {
    static $list = get('/list', { resp: { 200: z.string() } });
    list = List.$list(async () => 'x');
  }
  const tools = mcpTools(compose({ Ro, List }, { schemas: new ZodAdapter() })).document.tools as Array<{
    name: string;
    annotations?: Record<string, boolean>;
  }>;
  expect(tools.find((t) => t.name === 'ro')!.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  expect(tools.find((t) => t.name === 'List.list')!.annotations).toMatchObject({ readOnlyHint: true });
});

test('io: ZodAdapter input vs output for .default()', () => {
  const s = z.object({ n: z.number().default(5) });
  const adapter = new ZodAdapter();
  const inp = adapter.jsonSchema(s, 'input') as { required?: string[] };
  const out = adapter.jsonSchema(s, 'output') as { required?: string[] };
  expect(inp.required ?? []).not.toContain('n');
  expect(out.required ?? []).toContain('n');
});
