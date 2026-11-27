// Регрессии по ревью: C15 (null стирается NonNullable), C16 (кортежи сплющиваются).
// Type-level: проверяются tsc --noEmit (expectTypeOf даёт ошибку типа при расхождении).

import { expectTypeOf, test } from 'vitest';
import type { ApplyWire, JsonWire, JsonWireOf } from './types';

test('C15: ApplyWire keeps a legitimate null (NonNullable would erase it)', () => {
  expectTypeOf<ApplyWire<JsonWire, null>>().toEqualTypeOf<null>();
  expectTypeOf<ApplyWire<JsonWire, string>>().toEqualTypeOf<string>();
  expectTypeOf<ApplyWire<JsonWire, { a: number }>>().toEqualTypeOf<{ a: number }>();
});

test('C16: JsonWireOf preserves tuples and maps Date elements ([number, Date] → [number, string])', () => {
  expectTypeOf<JsonWireOf<[number, Date]>>().toEqualTypeOf<[number, string]>();
  expectTypeOf<JsonWireOf<Date[]>>().toEqualTypeOf<string[]>();
  expectTypeOf<JsonWireOf<{ at: Date; n: number }>>().toEqualTypeOf<{ at: string; n: number }>();
});