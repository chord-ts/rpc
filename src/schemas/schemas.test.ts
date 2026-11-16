import { expect, test } from 'vitest';
import { z } from 'zod';
import { defaultSchemas, flatToolSchema, packToolArgs, type AnySchema } from '../index';
import { ZodAdapter } from './zod';

const adapter = new ZodAdapter();
const toJson = (s: AnySchema) => adapter.jsonSchema(s);

test('ZodAdapter: jsonSchema + isObject', () => {
  const obj = z.object({ a: z.string() });
  expect(adapter.isObject(obj)).toBe(true);
  expect(adapter.isObject(z.number())).toBe(false);
  expect(toJson(obj)).toMatchObject({ type: 'object', properties: { a: { type: 'string' } } });
});

test('flatToolSchema: fn object → in as-is, fn scalar → { value }', () => {
  const objIn = z.object({ a: z.string() });
  expect(flatToolSchema({ in: objIn }, adapter)).toBe(objIn);

  const scalar = flatToolSchema({ in: z.number() }, adapter);
  expect(scalar['~standard'].validate({ value: 42 })).toEqual({ value: { value: 42 } });
});

test('flatToolSchema: REST merges parts + auto-path from template', () => {
  const contract = {
    in: z.unknown(),
    rest: { endpoint: '/items/{item_id}' },
    query: z.object({ q: z.string().optional() }),
  };
  const schema = flatToolSchema(contract, adapter);
  expect(schema['~standard'].validate({ item_id: '7', q: 'x' })).toEqual({ value: { item_id: '7', q: 'x' } });
  // auto-path field is a required string
  expect(toJson(schema)).toMatchObject({ required: ['item_id'] });
});

test('packToolArgs: REST → slices, fn scalar → unwrap, fn object → as-is', () => {
  const rest = { in: z.unknown(), rest: { endpoint: '/x' } };
  expect(packToolArgs(rest, { a: 1 }, toJson)).toEqual({ path: { a: 1 }, query: { a: 1 }, body: { a: 1 } });

  const scalar = { in: z.number() };
  expect(packToolArgs(scalar, { value: 41 }, toJson)).toBe(41);

  const obj = { in: z.object({ a: z.number() }) };
  expect(packToolArgs(obj, { a: 1 }, toJson)).toEqual({ a: 1 });
});

test('defaultSchemas: generic flatObject merges stripping parts, wrapScalar', async () => {
  const flat = defaultSchemas.flatObject([z.object({ a: z.string() }), z.object({ b: z.number() })], {
    id: defaultSchemas.string(),
  });
  const r = await flat['~standard'].validate({ a: 'x', b: 2, id: '7', extra: true });
  expect(r).toEqual({ value: { a: 'x', b: 2, id: '7' } });

  const wrapped = defaultSchemas.wrapScalar(z.number());
  expect(await wrapped['~standard'].validate({ value: 5 })).toEqual({ value: { value: 5 } });
});