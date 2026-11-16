// zod vendor adapter (opt-in leaf, peer dep: zod). Native zod operations — LangChain gets a real
// z.object, not a wrapper. Registered once: compose({ schemas: new ZodAdapter() }).

import { z } from 'zod';
import type { AnySchema, SchemaAdapter } from '../types';

export class ZodAdapter implements SchemaAdapter {
  jsonSchema(schema: AnySchema): unknown {
    return z.toJSONSchema(schema as z.ZodTypeAny);
  }
  isObject(schema: AnySchema): boolean {
    return schema instanceof z.ZodObject;
  }
  flatObject(parts: AnySchema[], extra: Record<string, AnySchema>): AnySchema {
    const shape: z.ZodRawShape = { ...(extra as z.ZodRawShape) };
    for (const p of parts) {
      if (p instanceof z.ZodObject) Object.assign(shape, p.shape);
    }
    return z.object(shape);
  }
  wrapScalar(schema: AnySchema): AnySchema {
    return z.object({ value: schema as z.ZodTypeAny });
  }
  string(): AnySchema {
    return z.string();
  }
}