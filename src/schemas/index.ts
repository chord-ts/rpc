// Schema operations layer. Imports only the shared types — the generic adapter is dep-free
// (~standard). Vendor adapters (schemas/zod, …) are opt-in leaves that import their library.
// Минимальный интерфейс адаптера — jsonSchema (единственное, что нужно генерации спеков).
// Плоские схемы тулов строятся generic ~standard-билдерами, без вендорных методов в интерфейсе.

import type { AnySchema, SchemaAdapter } from '../types';
import type { Core } from '../core/types';

const std = (s: AnySchema) =>
  (s as unknown as { '~standard': { jsonSchema?: unknown } })['~standard'];

/** Разрешает адаптер схемы: зарегистрированный (core.schemas) или generic default, с точечным
 * override конвертера JSON Schema. Генераторы/биндинги читают core.schemas — override встроен сюда,
 * а не протаскивается вручную через { jsonSchema } в каждый вызов. */
export function resolveSchemas(core: Core<any>, override?: (s: AnySchema) => unknown): SchemaAdapter {
  const base = core.schemas ?? defaultSchemas;
  return override ? { ...base, jsonSchema: override } : base;
}

/** Generic ~standard adapter: работает с любой Standard Schema библиотекой без регистрации.
 * JSON Schema через Standard JSON Schema v1 конвертер (`output({target})`) или вызываемый
 * `jsonSchema(s)`; {} когда конвертера нет. Unrepresentable-типы (void/date) НЕ деградируются —
 * для них вендорный адаптер (ZodAdapter с z.toJSONSchema unrepresentable:'any') на уровне compose. */
export const defaultSchemas: SchemaAdapter = {
  jsonSchema: (s) => {
    const js = std(s).jsonSchema;
    if (typeof js === 'function') return (js as (x: AnySchema) => unknown)(s);
    if (js && typeof (js as { output?: unknown }).output === 'function') {
      return (js as { output: (o: { target: string }) => unknown }).output({ target: 'draft-2020-12' });
    }
    return {};
  },
};

// --- Generic ~standard билдеры плоских схем (для flatToolSchema) ---

/** Скаляр → { value: T } (MCP/LangChain требуют object-схему). */
export function wrapScalar(s: AnySchema): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      async validate(value) {
        const r = await s['~standard'].validate((value as { value?: unknown })?.value);
        return 'issues' in r ? r : { value: { value: r.value } };
      },
    },
  };
}

/** Слияние частей (path/query/body) + именованных полей в одну плоскую схему: каждая часть
 * валидирует свои поля из плоского значения (stripping), extra — по имени. */
export function flatObject(parts: AnySchema[], extra: Record<string, AnySchema>): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      async validate(value) {
        const merged: Record<string, unknown> = {};
        const issues: unknown[] = [];
        for (const p of parts) {
          const r = await p['~standard'].validate(value);
          if ('issues' in r) issues.push(...r.issues);
          else Object.assign(merged, r.value as object);
        }
        for (const [name, s] of Object.entries(extra)) {
          const r = await s['~standard'].validate((value as Record<string, unknown>)?.[name]);
          if ('issues' in r) issues.push(...r.issues);
          else merged[name] = r.value;
        }
        return issues.length > 0 ? { issues } : { value: merged };
      },
    },
  };
}

/** Generic строковая схема (auto-path поля REST). */
export function stringSchema(): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      validate: (v) => (typeof v === 'string' ? { value: v } : { issues: [{ message: 'expected string' }] }),
    },
  };
}

/** Плоская схема тула из контракта — одна для всех фреймворков, generic ~standard.
 * fn: `in` как есть (object) или { value: T } (скаляр). REST: path/query/body части + auto-path.
 * Адаптер даёт только jsonSchema; сборка плоской схемы — generic-билдерами выше. */
export function flatToolSchema(
  contract: { in: AnySchema } & Record<string, unknown>,
  schemas: SchemaAdapter,
): AnySchema {
  const rest = contract.rest as { endpoint: string } | undefined;
  if (!rest) {
    const isObject = (schemas.jsonSchema(contract.in) as { type?: string }).type === 'object';
    return isObject ? contract.in : wrapScalar(contract.in);
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
    if (!covered.has(m[1])) extra[m[1]] = stringSchema();
  }
  return flatObject(parts, extra);
}

/** Упаковка аргументов тула в core params — общая для mcp-биндинга и agent tools.
 * REST: плоские args раскладываются по срезам (каждая часть валидирует свои поля). fn: скаляр из { value }. */
export function packToolArgs(
  contract: { in: AnySchema; rest?: unknown } & Record<string, unknown>,
  args: unknown,
  toJson: (s: AnySchema) => unknown,
): unknown {
  if (contract.rest) {
    const flat = args ?? {};
    return { path: flat, query: flat, body: flat };
  }
  const rawIn = toJson(contract.in) as { type?: string };
  return rawIn.type !== 'object' ? (args as { value?: unknown } | undefined)?.value : args;
}