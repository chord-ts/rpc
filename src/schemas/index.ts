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
export function resolveSchemas(core: Core<any>, override?: (s: AnySchema, io?: 'input' | 'output') => unknown): SchemaAdapter {
  const base = core.schemas ?? defaultSchemas;
  return override ? { ...base, jsonSchema: override } : base;
}

/** Generic ~standard adapter: работает с любой Standard Schema библиотекой без регистрации.
 * JSON Schema через Standard JSON Schema v1 конвертер (`output({target})`) или вызываемый
 * `jsonSchema(s)`; {} когда конвертера нет. Unrepresentable-типы (void/date) НЕ деградируются —
 * для них вендорный адаптер (ZodAdapter с z.toJSONSchema unrepresentable:'any') на уровне compose. */
export const defaultSchemas: SchemaAdapter = {
  jsonSchema: (s, io = 'output') => {
    const js = std(s).jsonSchema;
    if (typeof js === 'function') return (js as (x: AnySchema) => unknown)(s);
    if (js && typeof (js as { output?: unknown }).output === 'function') {
      const conv = js as {
        input: (o: { target: string }) => unknown;
        output: (o: { target: string }) => unknown;
      };
      return io === 'input' ? conv.input({ target: 'draft-2020-12' }) : conv.output({ target: 'draft-2020-12' });
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
          else {
            // Own-key copy skipping __proto__: Object.assign would trigger the prototype setter.
            const v = r.value as Record<string, unknown>;
            for (const k of Object.keys(v)) if (k !== '__proto__') merged[k] = v[k];
          }
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

/** Non-object REST body (array/scalar): no properties and not type:object → it travels under the
 * `body` key (mirrors rest.ts RestIn/composite), not as flat-merged fields. */
const nonObjectBody = (j: { type?: string; properties?: unknown } | undefined): boolean =>
  j !== undefined && j.type !== 'object' && j.properties === undefined;

/** Validate the `body` slot of flat tool args and keep the parsed value under `body`, so flatObject
 * merges it as one key (an array body must not be spread into {0:…}). */
function bodySlotSchema(s: AnySchema): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      async validate(value) {
        const r = await s['~standard'].validate((value as { body?: unknown })?.body);
        return 'issues' in r ? r : { value: { body: r.value } };
      },
    },
  };
}

/** Плоский JSON Schema тула (object-форма) — общий для mcpTools-дескриптора и flatToolSchema.
 * fn: object как есть, скаляр → { value: T }. REST: path/query/body части + auto-path из шаблона. */
export function flatToolJson(
  contract: { in: AnySchema } & Record<string, unknown>,
  toJson: (s: AnySchema) => unknown,
): Record<string, unknown> {
  const rest = contract.rest as { endpoint: string } | undefined;
  if (!rest) {
    const json = toJson(contract.in) as { type?: string };
    return json.type === 'object' ? json : { type: 'object', properties: { value: json }, required: ['value'] };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const part of ['path', 'query', 'body'] as const) {
    const s = contract[part] as AnySchema | undefined;
    if (!s) continue;
    const pj = toJson(s) as { properties?: Record<string, unknown>; required?: string[]; type?: string };
    if (part === 'body' && nonObjectBody(pj)) {
      properties.body = pj;
      required.push('body');
      continue;
    }
    Object.assign(properties, pj.properties ?? {});
    required.push(...(pj.required ?? []));
  }
  for (const m of rest.endpoint.matchAll(/\{([^}]+)\}/g)) {
    // Own-key check, not `in`: a path param named toString/constructor is inherited from
    // Object.prototype, so `in` would skip it and the advertised schema would lose the field.
    if (!Object.hasOwn(properties, m[1])) {
      properties[m[1]] = { type: 'string' };
      required.push(m[1]);
    }
  }
  return { type: 'object', properties, required };
}

/** ЕДИНЫЙ метод схемы тула для MCP и tools: возвращает StandardSchemaWithJSON (validate + jsonSchema
 * Converter из адаптера). registerTool/agentTools принимают напрямую, без fromJsonSchema.
 * fn: object как есть по validate, но jsonSchema всегда из адаптера (смягчает Date/void, иначе
 * tools/list падает на непредставимых полях); скаляр → { value: T }. REST: части + auto-path. */
export function flatToolSchema(
  contract: { in: AnySchema } & Record<string, unknown>,
  schemas: SchemaAdapter,
): AnySchema {
  const toJson = (s: AnySchema) => schemas.jsonSchema(s, 'input');
  const json = flatToolJson(contract, toJson);
  const rest = contract.rest as { endpoint: string } | undefined;
  if (!rest) {
    const isObject = (toJson(contract.in) as { type?: string }).type === 'object';
    if (isObject) {
      // validate — нативная схема; advertised jsonSchema — из адаптера (не raw zod с Date/void).
      return withJsonSchema(contract.in, json);
    }
    return withJsonSchema(wrapScalar(contract.in), json);
  }
  const parts: AnySchema[] = [];
  const covered = new Set<string>();
  for (const part of ['path', 'query', 'body'] as const) {
    const s = contract[part] as AnySchema | undefined;
    if (!s) continue;
    const pj = toJson(s) as { properties?: Record<string, unknown>; type?: string };
    parts.push(part === 'body' && nonObjectBody(pj) ? bodySlotSchema(s) : s);
    for (const name of Object.keys(pj.properties ?? {})) covered.add(name);
  }
  const extra: Record<string, AnySchema> = {};
  for (const m of rest.endpoint.matchAll(/\{([^}]+)\}/g)) {
    if (!covered.has(m[1])) extra[m[1]] = stringSchema();
  }
  return withJsonSchema(flatObject(parts, extra), json);
}

/** Оборачивает схему в StandardSchemaWithJSON: validate базы + jsonSchema Converter из адаптера.
 * registerTool принимает схему напрямую (без fromJsonSchema): validate проверяет args, jsonSchema
 * рекламирует форму в tools/list. Schema-agnostic — JSON даёт адаптер, не вендорная библиотека. */
export function withJsonSchema(base: AnySchema, json: Record<string, unknown>): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      // Check-only: on success return the ORIGINAL value, not the parsed one. Transforms/defaults
      // must run exactly once — in core.call. A framework that validates with this schema and hands
      // its parsed output to invoke would otherwise get it re-validated against the INPUT schema
      // (z.string().transform(s => s.length): the second pass sees a number and fails).
      validate: async (value) => {
        const r = await base['~standard'].validate(value);
        return 'issues' in r ? r : { value };
      },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

/** Упаковка аргументов тула в core params — общая для mcp-биндинга и agent tools.
 * REST: плоские args раскладываются по срезам (каждая часть валидирует свои поля). fn: скаляр из { value }. */
export function packToolArgs(
  contract: { in: AnySchema; rest?: unknown } & Record<string, unknown>,
  args: unknown,
  toJson: (s: AnySchema) => unknown,
): unknown {
  if (contract.rest) {
    const flat = (args ?? {}) as Record<string, unknown>;
    const bodySchema = contract.body as AnySchema | undefined;
    const whole = bodySchema !== undefined && nonObjectBody(toJson(bodySchema) as { type?: string; properties?: unknown });
    return { path: flat, query: flat, body: whole ? flat.body : flat };
  }
  const rawIn = toJson(contract.in) as { type?: string };
  return rawIn.type !== 'object' ? (args as { value?: unknown } | undefined)?.value : args;
}