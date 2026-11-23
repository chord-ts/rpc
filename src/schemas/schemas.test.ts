import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, defaultSchemas, resolveSchemas, flatToolSchema, packToolArgs, wrapScalar, flatObject, stringSchema, type AnySchema } from '../index';
import { ZodAdapter } from './zod';

const adapter = new ZodAdapter();
const toJson = (s: AnySchema) => adapter.jsonSchema(s);

test('ZodAdapter: jsonSchema (минимальный интерфейс)', () => {
  const obj = z.object({ a: z.string() });
  expect((adapter.jsonSchema(obj) as any).type).toBe('object');
  expect((adapter.jsonSchema(z.number()) as any).type).toBe('number');
  expect(toJson(obj)).toMatchObject({ type: 'object', properties: { a: { type: 'string' } } });
});

test('ZodAdapter: void/date (unrepresentable:any) не бросает; generic default бросает', () => {
  expect(() => adapter.jsonSchema(z.void())).not.toThrow();
  expect(() => adapter.jsonSchema(z.date())).not.toThrow();
  expect(() => defaultSchemas.jsonSchema(z.void())).toThrow();
});

test('flatToolSchema: fn object → in as-is, fn scalar → { value }', async () => {
  const objIn = z.object({ a: z.string() });
  expect(flatToolSchema({ in: objIn }, adapter)).toBe(objIn);

  const scalar = flatToolSchema({ in: z.number() }, adapter);
  expect(await scalar['~standard'].validate({ value: 42 })).toEqual({ value: { value: 42 } });
});

test('flatToolSchema: единый метод несёт jsonSchema Converter (MCP/tools без fromJsonSchema)', () => {
  const scalar = flatToolSchema({ in: z.number() }, adapter);
  const conv = scalar['~standard'].jsonSchema!;
  expect(conv.output({ target: 'draft-2020-12' })).toMatchObject({
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
  });
  // object — identity, jsonSchema из вендорной схемы
  const objIn = z.object({ a: z.string() });
  expect(flatToolSchema({ in: objIn }, adapter)['~standard'].jsonSchema).toBeTruthy();
});

test('flatToolSchema: REST merges parts + auto-path from template (generic)', async () => {
  const contract = {
    in: z.unknown(),
    rest: { endpoint: '/items/{item_id}' },
    query: z.object({ q: z.string().optional() }),
  };
  const schema = flatToolSchema(contract, adapter);
  expect(await schema['~standard'].validate({ item_id: '7', q: 'x' })).toEqual({ value: { item_id: '7', q: 'x' } });
});

test('packToolArgs: REST → slices, fn scalar → unwrap, fn object → as-is', () => {
  const rest = { in: z.unknown(), rest: { endpoint: '/x' } };
  expect(packToolArgs(rest, { a: 1 }, toJson)).toEqual({ path: { a: 1 }, query: { a: 1 }, body: { a: 1 } });

  const scalar = { in: z.number() };
  expect(packToolArgs(scalar, { value: 41 }, toJson)).toBe(41);

  const obj = { in: z.object({ a: z.number() }) };
  expect(packToolArgs(obj, { a: 1 }, toJson)).toEqual({ a: 1 });
});

test('generic билдеры: flatObject merges stripping parts, wrapScalar, stringSchema', async () => {
  const flat = flatObject([z.object({ a: z.string() }), z.object({ b: z.number() })], {
    id: stringSchema(),
  });
  const r = await flat['~standard'].validate({ a: 'x', b: 2, id: '7', extra: true });
  expect(r).toEqual({ value: { a: 'x', b: 2, id: '7' } });

  const wrapped = wrapScalar(z.number());
  expect(await wrapped['~standard'].validate({ value: 5 })).toEqual({ value: { value: 5 } });
});

test('resolveSchemas: зарегистрированный адаптер + точечный override, fallback на default', () => {
  const core = compose({}, { inject: {}, schemas: adapter });
  expect(resolveSchemas(core)).toBe(adapter);
  const override = () => ({ type: 'string' });
  expect(resolveSchemas(core, override).jsonSchema).toBe(override);
  expect(resolveSchemas(compose({}, { inject: {} })).jsonSchema).toBe(defaultSchemas.jsonSchema);
});