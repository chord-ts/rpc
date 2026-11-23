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
export function converter(opts: GenOptions, core: Core<any>): (s: AnySchema) => unknown {
  const toJson = resolveSchemas(core, opts.jsonSchema).jsonSchema;
  return (s) => {
    const out = toJson(s);
    if (out && typeof out === 'object' && '$schema' in out) {
      const { $schema: _drop, ...rest } = out as Record<string, unknown>;
      return rest;
    }
    return out;
  };
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