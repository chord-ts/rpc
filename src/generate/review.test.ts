// Регрессии по ревью: B9 (OpenRPC $defs), H6 (MCP shipped-код), средний io (input/output).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, compose } from '../index';
import { openrpc } from '@/jsonrpc';
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

test('io: ZodAdapter input vs output for .default()', () => {
  const s = z.object({ n: z.number().default(5) });
  const adapter = new ZodAdapter();
  const inp = adapter.jsonSchema(s, 'input') as { required?: string[] };
  const out = adapter.jsonSchema(s, 'output') as { required?: string[] };
  expect(inp.required ?? []).not.toContain('n');
  expect(out.required ?? []).toContain('n');
});
