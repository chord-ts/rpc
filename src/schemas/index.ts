// Schema operations layer. Imports only the shared types — the generic adapter is dep-free
// (~standard). Vendor adapters (schemas/zod, …) are opt-in leaves that import their library.
// generate/tools/protocol read the registered adapter (core.schemas) and these operations.

import type { AnySchema, SchemaAdapter } from '../types';

const std = (s: AnySchema) =>
  (s as unknown as { '~standard': { jsonSchema?: unknown } })['~standard'];

/** Generic ~standard adapter: works with any Standard Schema library without registration.
 * JSON Schema via the Standard JSON Schema v1 converter (`output({target})`) or a callable
 * `jsonSchema(s)`; degrades to {} when neither is present. Flat schemas are built by
 * stripping-validation of parts (a vendor adapter gives native ones). */
export const defaultSchemas: SchemaAdapter = {
  jsonSchema: (s) => {
    const js = std(s).jsonSchema;
    if (typeof js === 'function') return (js as (x: AnySchema) => unknown)(s);
    if (js && typeof (js as { output?: unknown }).output === 'function') {
      return (js as { output: (o: { target: string }) => unknown }).output({ target: 'draft-2020-12' });
    }
    return {};
  },
  isObject(s) {
    return (this.jsonSchema(s) as { type?: string }).type === 'object';
  },
  flatObject(parts, extra) {
    return {
      '~standard': {
        version: 1,
        vendor: 'chord',
        async validate(value) {
          const merged: Record<string, unknown> = {};
          const issues: unknown[] = [];
          // Parts are stripping objects: each takes its own fields from the flat value.
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
  },
  wrapScalar(s) {
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
  },
  string() {
    return {
      '~standard': {
        version: 1,
        vendor: 'chord',
        validate: (v) => (typeof v === 'string' ? { value: v } : { issues: [{ message: 'expected string' }] }),
      },
    };
  },
};

/** Flat tool schema from a contract — one for all frameworks; vendor ops live in the adapter.
 * fn: `in` as-is (object) or { value: T } (scalar). REST: path/query/body parts + auto-path. */
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

/** Pack tool arguments into core params — shared by the mcp binding and agent tools.
 * REST: flat args spread into slices (each part validates its own fields). fn: scalar unwrapped from { value }. */
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