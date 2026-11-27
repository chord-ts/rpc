// Общие хелперы генерации (generate-слой, ниже protocol). Протокол-генераторы живут рядом со
// своими протоколами (jsonrpc/docs, rest-docs, events-docs, mcp/tools) и импортят это ядро.
// Core остаётся generation-agnostic — хелперы НЕ в src/core (изоляция ядра сохранена).

import type { AnySchema, HttpProtocol } from '../types';
import type { Core } from '../core/types';
import { resolveSchemas } from '../schemas';

export interface GenOptions {
  jsonSchema?: (s: AnySchema) => unknown;
  info?: { title: string; version: string; description?: string };
}

/** Генератор возвращает binding: спеку можно отдать GET-эндпоинтом через fromSvelteKit(openrpc(…)),
 * а сам документ доступен как .document (для rpc.discover, rest-docs, mcp tools/list, CLI/экспорта). */
export interface Spec<T = object> extends HttpProtocol {
  document: T;
}

export function serveSpec<T>(document: T): Spec<T> {
  const body = JSON.stringify(document, null, 2);
  return {
    document,
    http: {
      async handle() {
        return { status: 200, headers: { 'content-type': 'application/json' }, body, raw: true };
      },
    },
  };
}

// UI-вьюеры (swagger/redoc/clef) — binding, который пользователь вешает на свой GET-роут. Документ
// вшит inline (spec:), отдельный маунт и CORS не нужны. Путь маунта выбирает пользователь.
export function serveHtml(body: string): HttpProtocol {
  return {
    http: {
      async handle() {
        return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body, raw: true };
      },
    },
  };
}

// Inline-JSON в <script>: экранируем '<', чтобы описание схемы не разорвало тег (</script>).
export const inlineJson = (document: unknown) => JSON.stringify(document).replace(/</g, '\\u003c');

/** Schema converter: из адаптера в compose (core.schemas), fallback generic; opts.jsonSchema —
 * точечный override. $schema снимается при встраивании. */
export function converter(opts: GenOptions, core: Core<any>): (s: AnySchema, io?: 'input' | 'output') => unknown {
  const toJson = resolveSchemas(core, opts.jsonSchema).jsonSchema;
  return (s, io) => {
    const out = toJson(s, io);
    if (out && typeof out === 'object' && '$schema' in out) {
      const { $schema: _drop, ...rest } = out as Record<string, unknown>;
      return rest;
    }
    return out;
  };
}

/** Hoist a schema's local `$defs` into a shared `components.schemas` map and rewrite every
 * `#/$defs/X` ref to `#/components/schemas/<prefix>_X`. Embedded schemas (OpenRPC params/result,
 * OpenAPI parameters) resolve refs against the DOCUMENT root, so local $defs would dangle.
 * The prefix keeps keys unique across methods even when a vendor reuses names like __schema0. */
export function hoistSchemaDefs(schema: unknown, components: Record<string, unknown>, prefix: string): unknown {
  let rootRef = false;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$defs') continue; // hoisted into components
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/')) {
        out[k] = `#/components/schemas/${prefix}_${v.slice('#/$defs/'.length)}`;
      } else if (k === '$ref' && v === '#') {
        // Recursive root ref (z.lazy): '#' points at the schema root, which must live in
        // components too — against the DOCUMENT root it would dangle.
        rootRef = true;
        out[k] = `#/components/schemas/${prefix}`;
      } else {
        out[k] = rewrite(v);
      }
    }
    return out;
  };
  if (schema && typeof schema === 'object') {
    const defs = (schema as Record<string, unknown>).$defs as Record<string, unknown> | undefined;
    if (defs) for (const [key, def] of Object.entries(defs)) components[`${prefix}_${key}`] = rewrite(def);
  }
  const out = rewrite(schema);
  if (rootRef) components[prefix] = out; // self-recursion resolves through components
  return out;
}

export const infoOf = (opts: GenOptions) => opts.info ?? { title: 'Chord RPC', version: '1.0.0' };

const REASON: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 500: 'Internal Server Error',
};
export const reasonPhrase = (status: number) => REASON[status] ?? 'Response';

export type JsonObj = { properties?: Record<string, unknown>; required?: string[] };

// --- stream metadata: optional channel override for AsyncAPI (default channel = Service.method) ---
export interface StreamMeta {
  channel: string;
}