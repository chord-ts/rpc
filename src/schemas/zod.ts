// zod vendor adapter (opt-in leaf, peer dep: zod). Минимальный интерфейс — jsonSchema.
// Registered once: compose({ schemas: new ZodAdapter() }).

import { z } from 'zod';
import type { AnySchema, SchemaAdapter } from '../types';

export class ZodAdapter implements SchemaAdapter {
  jsonSchema(schema: AnySchema, io: 'input' | 'output' = 'output'): unknown {
    // zod4: void/date непредставимы в JSON Schema — смягчаем до any штатной опцией конвертера.
    // io:'input' описывает поля с .default()/.transform() так, как их принимает обработчик.
    return z.toJSONSchema(schema as z.ZodTypeAny, { io, unrepresentable: 'any' });
  }
}