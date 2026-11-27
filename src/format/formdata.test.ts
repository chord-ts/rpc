// Нативный formdata-кодек: FormData ↔ плоское значение. Скаляры → строки, Blob/File как есть,
// массивы → повторяющиеся поля, вложенные объекты → JSON-строка. Type-level — FormWire.

import { expect, expectTypeOf, test } from 'vitest';
import { formdata } from './index';
import type { ApplyWire, FormWire, FormWireOf } from './types';

test('encode: scalars become strings, arrays become repeated fields', () => {
  const fd = formdata.encode({ name: 'widget', count: 3, ok: true, tag: ['a', 'b'] });
  expect(fd.get('name')).toBe('widget');
  expect(fd.get('count')).toBe('3');
  expect(fd.get('ok')).toBe('true');
  expect(fd.getAll('tag')).toEqual(['a', 'b']);
});

test('encode: nested object → JSON string, Date → ISO string, undefined skipped', () => {
  const fd = formdata.encode({ meta: { a: 1 }, at: new Date('2026-01-01T00:00:00Z'), gone: undefined });
  expect(fd.get('meta')).toBe('{"a":1}');
  expect(fd.get('at')).toBe('2026-01-01T00:00:00.000Z');
  expect(fd.has('gone')).toBe(false);
});

test('encode: Blob/File pass through unchanged', () => {
  const file = new File(['x'], 'a.txt', { type: 'text/plain' });
  const fd = formdata.encode({ file });
  expect(fd.get('file')).toBeInstanceOf(File);
  expect((fd.get('file') as File).name).toBe('a.txt');
});

test('encode: null/undefined → empty FormData; non-object throws', () => {
  expect([...formdata.encode(null)].length).toBe(0);
  expect([...formdata.encode(undefined)].length).toBe(0);
  expect(() => formdata.encode(5)).toThrow();
  expect(() => formdata.encode([1, 2])).toThrow();
});

test('decode: lone field stays scalar, repeated fields collect into an array', () => {
  const fd = new FormData();
  fd.append('name', 'widget');
  fd.append('tag', 'a');
  fd.append('tag', 'b');
  const obj = formdata.decode(fd) as Record<string, unknown>;
  expect(obj.name).toBe('widget');
  expect(obj.tag).toEqual(['a', 'b']);
});

test('decode: __proto__ becomes an own key, not prototype pollution', () => {
  const fd = new FormData();
  fd.append('__proto__', 'evil');
  const obj = formdata.decode(fd) as Record<string, unknown>;
  expect(Object.getPrototypeOf(obj)).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(obj, '__proto__')).toBe(true);
  expect((Object.prototype as { evil?: unknown }).evil).toBeUndefined();
});

test('round-trip: encode → decode preserves strings, arrays and Blob', () => {
  const blob = new Blob(['data']);
  const fd = formdata.encode({ name: 'widget', tag: ['a', 'b'], blob });
  const obj = formdata.decode(fd) as Record<string, unknown>;
  expect(obj.name).toBe('widget');
  expect(obj.tag).toEqual(['a', 'b']);
  expect(obj.blob).toBeInstanceOf(Blob);
});

test('FormWire: scalars → string, nested object → string, array → array, Blob kept', () => {
  expectTypeOf<FormWireOf<{ id: string; count: number; ok: boolean }>>().toEqualTypeOf<{ id: string; count: string; ok: string }>();
  expectTypeOf<FormWireOf<{ meta: { a: number } }>>().toEqualTypeOf<{ meta: string }>();
  expectTypeOf<FormWireOf<{ tags: number[] }>>().toEqualTypeOf<{ tags: string[] }>();
  expectTypeOf<FormWireOf<{ at: Date }>>().toEqualTypeOf<{ at: string }>();
  expectTypeOf<FormWireOf<{ file: Blob }>>().toEqualTypeOf<{ file: Blob }>();
});

test('FormWire: optional fields stay optional; scalars (incl. null) stringify', () => {
  expectTypeOf<FormWireOf<{ opt?: number }>>().toEqualTypeOf<{ opt?: string }>();
  // formdata плоский: null-поле кодируется как 'null' (String(null)), в отличие от json.
  expectTypeOf<ApplyWire<FormWire, null>>().toEqualTypeOf<string>();
  expectTypeOf<ApplyWire<FormWire, { n: number }>>().toEqualTypeOf<{ n: string }>();
});
