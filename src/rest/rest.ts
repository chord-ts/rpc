// REST protocol: declaration sugar (get/post/…, FastAPI-style parts) + binding (routing, slices,
// resp status map). fn stays in core; REST sugar lives here. Docs — отдельные binding'и (generate).
// Format codecs only the HTTP body; status/headers/path are protocol+transport, not Format.

import { fn } from '@/core';
import { CoreError, type Core, type MaybeArray, type Middleware, type ServiceMap } from '@/core/types';
import type { AnySchema, Binding, HttpProtocol, RestMeta, ServiceTag } from '@/types';
import type { Format, FormatTag, WireFn, JsonWire } from '@/format/types';
import { json } from '@/format';

// --- declaration sugar: parts instead of flat in ---

/** REST contract: path optional (template names typed as string without a schema).
 * resp is a status map (FastAPI responses): { 201: schema, 409: schema }. The success-status
 * schema (status ?? 200) is the handler return type and the out validator. */
export interface RestContract {
  path?: AnySchema<any>;
  query?: AnySchema<any>;
  body?: AnySchema<any>;
  resp?: Record<number, AnySchema<any>>;
  use?: MaybeArray<Middleware<any>>;
  desc?: string;
  summary?: string;
  tags?: string[];
  deprecated?: boolean;
  status?: number;
}

// Path param names inferred from the template string literal.
type PathKeys<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | PathKeys<R> : never;
type AutoPath<S extends string> = { [K in PathKeys<S>]: string };

type PartOut<S> = S extends AnySchema<infer O> ? O : unknown;
// Non-object body (array/scalar) cannot flat-merge into path/query — it lives under the `body` key.
// Object body merges flat (unchanged). Arrays are objects in TS, so check any[] first.
type BodyPart<O> = O extends any[] ? { body: O } : O extends object ? O : { body: O };
type RestIn<C extends RestContract, P extends string> = (C['path'] extends AnySchema<any>
  ? PartOut<C['path']>
  : AutoPath<P>) &
  PartOut<C['query']> &
  (C['body'] extends AnySchema<any> ? BodyPart<PartOut<C['body']>> : unknown);

type SuccessStatus<C extends RestContract> = C['status'] extends number ? C['status'] : 200;
type RespOut<C extends RestContract> = C['resp'] extends Record<number, AnySchema<any>>
  ? SuccessStatus<C> extends keyof C['resp']
    ? PartOut<C['resp'][SuccessStatus<C>]>
    : unknown
  : unknown;

type RestHandler<C extends RestContract, P extends string> = (input: RestIn<C, P>) => Promise<RespOut<C>>;
type RestFn<C extends RestContract, P extends string> = C & {
  in: AnySchema<RestIn<C, P>>;
  out?: AnySchema<RespOut<C>>;
  fn: RestHandler<C, P>;
  rest: RestMeta & { endpoint: P };
  /** Callable-декларация: `$method(handler)` контекстно типизирует обработчик и возвращает его как есть. */
  (handler: RestHandler<C, P>): RestHandler<C, P>;
};

// Own-property merge (defineProperty, not Object.assign): Object.assign triggers the `__proto__`
// setter → prototype pollution of the handler input. `__proto__` keys are dropped outright.
function mergeSafe(target: Record<string, unknown>, src: unknown): void {
  if (src === null || typeof src !== 'object') return;
  for (const key of Object.keys(src as Record<string, unknown>)) {
    if (key === '__proto__') continue;
    Object.defineProperty(target, key, {
      value: (src as Record<string, unknown>)[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

/** Composite schema: vendor-agnostic `in` synthesized from parts. Validates each slice with its
 * part and merges PARSED values into one handler input. A part without a schema contributes
 * nothing — unvalidated body/query fields must not reach the handler (mass assignment) nor
 * overwrite validated ones; the only exception is path: template names are declared by the
 * endpoint itself, so they pass through as strings.
 * Merge order body → query → path: the path is authoritative and cannot be overwritten by a
 * same-named body/query field (resource-id spoofing). */
function composite(c: RestContract, endpoint: string): AnySchema<any> {
  const parts: [string, AnySchema<any> | undefined][] = [
    ['body', c.body],
    ['query', c.query],
    ['path', c.path],
  ];
  const pathNames = [...endpoint.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      async validate(value) {
        const slices = (value ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = {};
        const issues: unknown[] = [];
        for (const [name, schema] of parts) {
          const slice = slices[name] ?? {};
          if (!schema) {
            if (name === 'path' && slice !== null && typeof slice === 'object') {
              const picked: Record<string, unknown> = {};
              for (const n of pathNames) picked[n] = (slice as Record<string, unknown>)[n];
              mergeSafe(merged, picked);
            }
            continue;
          }
          const r = await schema['~standard'].validate(slice);
          if ('issues' in r) issues.push(...r.issues);
          else if (name === 'body' && (Array.isArray(r.value) || r.value === null || typeof r.value !== 'object')) {
            // Non-object body → the `body` slot (mirrors the RestIn type); object body merges flat.
            mergeSafe(merged, { body: r.value });
          } else mergeSafe(merged, r.value);
        }
        return issues.length > 0 ? { issues } : { value: merged };
      },
    },
  };
}

/** Generic REST declaration. Named http (not rest) to avoid clashing with the rest(composer) binding.
 * Flat `status` is hoisted into rest; the success-status schema from resp becomes `out`.
 * Callable, как core fn: `$method(handler)` типизирует обработчик из частей и возвращает его как есть. */
export function http<P extends string, C extends RestContract>(meta: RestMeta & { endpoint: P }, c: C): RestFn<C, P> {
  const rest = c.status !== undefined ? { ...meta, status: c.status } : meta;
  const out = c.resp?.[c.status ?? 200];
  return fn({ ...c, in: composite(c, meta.endpoint), ...(out ? { out } : {}), rest }) as unknown as RestFn<C, P>;
}
export const get = <P extends string, C extends RestContract>(endpoint: P, c: C) => http({ method: 'GET', endpoint }, c);
export const post = <P extends string, C extends RestContract>(endpoint: P, c: C) => http({ method: 'POST', endpoint }, c);
export const put = <P extends string, C extends RestContract>(endpoint: P, c: C) => http({ method: 'PUT', endpoint }, c);
export const patch = <P extends string, C extends RestContract>(endpoint: P, c: C) => http({ method: 'PATCH', endpoint }, c);
export const del = <P extends string, C extends RestContract>(endpoint: P, c: C) => http({ method: 'DELETE', endpoint }, c);

// --- binding ---

interface RestRoute extends RestMeta {
  service: string;
  handler: string; // service method name; `method` is the HTTP verb from RestMeta
  regex: RegExp;
  pathParams: string[];
}

function compilePath(template: string): { regex: RegExp; params: string[] } {
  // Adjacent placeholders ({a}{b}) compile to neighbouring ([^/]+) groups — catastrophic
  // backtracking on a non-matching path (ReDoS), and the split is ambiguous anyway. Reject early.
  if (/\}\{/.test(template)) {
    throw new Error(`[chord] REST endpoint "${template}": adjacent placeholders are ambiguous — separate them with a literal segment (e.g. {a}/{b})`);
  }
  const params: string[] = [];
  // Literal segments are regex-escaped; only {name} placeholders become capture groups.
  // Without escaping, '/items.json' would also match '/itemsXjson'.
  const pattern = template
    .split(/(\{[^}]+\})/g)
    .map((seg) => {
      const m = seg.match(/^\{([^}]+)\}$/);
      if (m) {
        params.push(m[1]);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return { regex: new RegExp(`^${pattern}$`), params };
}

/** REST: routes from endpoints().rest; params packed as slices { path, query, body } (composite `in`
 * validates each slice). Native errors → HTTP status (validation → 422). Pure routing — docs are
 * separate bindings the user mounts on their own GET (openapi/swagger/redoc from generate), so the
 * mount path is the user's choice and nothing assumes the binding sits at root. */
export function rest<S extends ServiceMap, F extends WireFn = JsonWire>(
  core: Core<S>,
  opts?: {
    format?: Format<any, F>;
  },
): HttpProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> } {
  const format = (opts?.format ?? json) as Format<any, F>;
  const routes: RestRoute[] = [];
  for (const e of core.endpoints()) {
    const meta = e.contract?.rest as RestMeta | undefined;
    if (!meta) continue;
    const { regex, params } = compilePath(meta.endpoint);
    routes.push({ ...meta, service: e.service, handler: e.method, regex, pathParams: params });
  }
  // Specificity first: fewer path params, then more literal characters — '/items/new' wins over
  // '/items/{id}' regardless of registration order.
  const literalLen = (s: string) => s.replace(/\{[^}]+\}/g, '').length;
  routes.sort((a, b) => a.pathParams.length - b.pathParams.length || literalLen(b.endpoint) - literalLen(a.endpoint));

  // REST транспорт-адресуемый (method+path) — нативный контракт HTTP, проекция одна.
  const http: Binding = {
    async handle(req, ctx) {
      const url = new URL(req.url);

      let route: RestRoute | undefined;
      let pathValues: Record<string, string> = {};
      let pathMatched = false;
      let decodeFailed = false;
      const allowed = new Set<string>();
      for (const r of routes) {
        const m = url.pathname.match(r.regex);
        if (!m) continue;
        pathMatched = true;
        allowed.add(r.method);
        if (r.method !== req.method) continue;
        route = r;
        try {
          pathValues = Object.fromEntries(r.pathParams.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        } catch {
          decodeFailed = true; // malformed percent-encoding must not throw out of handle
        }
        break;
      }
      if (decodeFailed) return { status: 400, body: { detail: 'Malformed path' } };
      if (!route) {
        // path matched another verb → 405 (RFC 9110: Allow is required); no path at all → 404.
        return pathMatched
          ? { status: 405, headers: { allow: [...allowed].join(', ') }, body: { detail: 'Method not allowed' } }
          : { status: 404, body: { detail: 'Not found' } };
      }

      // Repeated query keys (?tag=a&tag=b) become an array; a single key stays a string.
      // Null prototype: ?__proto__=… must create an own key, not set the object's prototype.
      const query: Record<string, unknown> = Object.create(null);
      for (const k of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(k);
        query[k] = all.length > 1 ? all : all[0];
      }
      // body — уже распарсенное значение (адаптер × Format или раннее извлечение). Decode не нужен.
      // Slices, not merge: each part validated by its schema (composite `in`).
      // query from URL is strings; numeric query fields declared with z.coerce.number().
      const params = { path: pathValues, query, body: req.body ?? {} };
      try {
        const value = await core.call(`${route.service}.${route.handler}`, params, { ctx });
        return { status: route.status ?? 200, body: value };
      } catch (e) {
        // REST мапит kind напрямую (без JSON-RPC-модели): invalid-params → 422 + issues, прочее → 500.
        if (e instanceof CoreError && e.kind === 'invalid-params') {
          const body = e.data === undefined ? { detail: e.message } : { detail: e.message, issues: e.data };
          return { status: 422, body };
        }
        // Handler-declared HTTP status (RpcError.status / Error+status, e.g. a resp-map 404/409):
        // an explicit status marks the error as intentional, so its message is safe to expose.
        const status = (e as { status?: unknown } | null)?.status;
        if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
          return { status, body: { detail: e instanceof Error ? e.message : 'Error' } };
        }
        // CoreError messages are intentional (validation); unexpected handler errors → generic,
        // so internal detail (connection strings, stacks) never leaks to the client.
        const detail = e instanceof CoreError ? e.message : 'Internal error';
        return { status: 500, body: { detail } };
      }
    },
  };
  return { http, format } as HttpProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> };
}