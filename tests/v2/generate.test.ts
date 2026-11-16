import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, get, compose, openapi, openrpc, mcpTools } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';

// REST-ресурс (сахар get). RPC-методы — отдельным классом (стили не смешиваются).
class Catalog {
  constructor() {}

  static $getItem = get('/items/{item_id}', {
    query: z.object({ q: z.string().optional() }),
    resp: { 200: z.object({ id: z.string() }) },
    desc: 'Получить предмет',
    tags: ['items'],
  });
  getItem: typeof Catalog.$getItem.fn = async () => ({ id: 'x' });
}

class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number(), desc: 'Инкремент' });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });

test('openapi: REST endpoint → path/query parameters + resp status', () => {
  const doc = openapi(composer, { info: { title: 'Catalog', version: '1.0.0' } }) as any;
  expect(doc.openapi).toBe('3.1.0');
  const get = doc.paths['/items/{item_id}'].get;
  expect(get.description).toBe('Получить предмет');
  const params = get.parameters;
  expect(params.find((p: any) => p.name === 'item_id')).toMatchObject({ in: 'path', required: true });
  expect(params.find((p: any) => p.name === 'q')).toMatchObject({ in: 'query', required: false });
  expect(get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'object' });
  // fn-метод без rest в OpenAPI не попадает
  expect(doc.paths['/items']).toBeUndefined();
});

test('openrpc: only fn methods (REST filtered out)', () => {
  const doc = openrpc(composer) as any;
  const names = doc.methods.map((m: any) => m.name);
  expect(names).toContain('Math.count');
  expect(names).not.toContain('Catalog.getItem');
});

test('mcpTools: all endpoints, REST flattened + auto-path, fn scalar wrapped', () => {
  const { tools } = mcpTools(composer) as any;
  const getItem = tools.find((t: any) => t.name === 'Catalog.getItem');
  expect(Object.keys(getItem.inputSchema.properties)).toEqual(expect.arrayContaining(['item_id', 'q']));
  expect(getItem.inputSchema.required).toContain('item_id');
  expect(getItem.annotations.readOnlyHint).toBe(true);

  const count = tools.find((t: any) => t.name === 'Math.count');
  expect(count.inputSchema).toMatchObject({ type: 'object', properties: { value: { type: 'number' } } });
});

test('generate works without registered adapter (generic fallback)', () => {
  const bare = compose({ Catalog }, { inject: {} });
  const doc = openapi(bare) as any;
  // defaultSchemas reads zod ~standard.jsonSchema natively
  expect(doc.paths['/items/{item_id}'].get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'object' });
});