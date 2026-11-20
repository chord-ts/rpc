// zod vendor adapter (opt-in leaf, peer dep: zod). Минимальный интерфейс — jsonSchema.
// Registered once: compose({ schemas: new ZodAdapter() }).

import { z } from 'zod';
import type { AnySchema, SchemaAdapter } from '../types';

export class ZodAdapter implements SchemaAdapter {
  jsonSchema(schema: AnySchema): unknown {
    // zod4: void/date непредставимы в JSON Schema — смягчаем до any штатной опцией конвертера.
    return z.toJSONSchema(schema as z.ZodTypeAny, { unrepresentable: 'any' });
  }
}