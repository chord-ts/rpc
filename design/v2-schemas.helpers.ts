// Вендорные адаптеры схем (ПРЕДЛАГАЕМОЕ API, спайк).
// Один класс-адаптер регистрируется в композере (compose(..., { schemas: new ZodAdapter() }))
// и под капотом разруливает все операции с библиотекой валидации: JSON Schema для
// генераторов, плоские схемы для тулов, обёртки скаляров, авто-path. Пользовательский
// код больше не вызывает z.toJSONSchema / zodToolSchema вручную.
//
// Прогон (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-mcp.example.ts

import { z } from 'zod4';
import type { AnySchema } from '../src/v2';
import type { SchemaAdapter } from './v2-transport.helpers';

/** zod-адаптер: нативные операции над zod-схемами (LangChain получает настоящий zod). */
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

/** Плоская схема тула из контракта — одна на все фреймворки, вендорные операции внутри адаптера.
 * fn: in как есть (объект) или { value: T } (скаляр). REST: части path/query/body + авто-path. */
export function flatToolSchema(
  contract: { in: AnySchema } & Record<string, unknown>,
  schemas: SchemaAdapter,
): AnySchema {
  const rest = contract.rest as { endpoint: string } | undefined;
  if (!rest) {
    return schemas.isObject(contract.in) ? contract.in : schemas.wrapScalar(contract.in);
  }
  const parts: AnySchema[] = [];
  const covered = new Set<string>();
  for (const part of ['path', 'query', 'body'] as const) {
    const s = contract[part] as AnySchema | undefined;
    if (!s) continue;
    parts.push(s);
    const props = (schemas.jsonSchema(s) as { properties?: Record<string, unknown> }).properties ?? {};
    for (const name of Object.keys(props)) covered.add(name);
  }
  const extra: Record<string, AnySchema> = {};
  for (const m of rest.endpoint.matchAll(/\{([^}]+)\}/g)) {
    if (!covered.has(m[1])) extra[m[1]] = schemas.string();
  }
  return schemas.flatObject(parts, extra);
}