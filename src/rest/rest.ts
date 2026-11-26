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
type RestIn<C extends RestContract, P extends string> = (C['path'] extends AnySchema<any>
  ? PartOut<C['path']>
  : AutoPath<P>) &
  PartOut<C['query']> &
  PartOut<C['body']>;

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
 * part (a part without a schema passes through), merges parsed values into one handler input.
 * Merge order body → query → path: the path is authoritative and cannot be overwritten by a
 * same-named body/query field (resource-id spoofing). */
function composite(c: RestContract): AnySchema<any> {
  const parts: [string, AnySchema<any> | undefined][] = [
    ['body', c.body],
    ['query', c.query],
    ['path', c.path],
  ];
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
            mergeSafe(merged, slice);
            continue;
          }
          const r = await schema['~standard'].validate(slice);
          if ('issues' in r) issues.push(...r.issues);
          else mergeSafe(merged, r.value);
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
  return fn({ ...c, in: composite(c), ...(out ? { out } : {}), rest }) as unknown as RestFn<C, P>;
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
      for (const r of routes) {
        const m = url.pathname.match(r.regex);
        if (!m) continue;
        pathMatched = true;
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
        // path matched another verb → 405; no path at all → 404.
        return pathMatched
          ? { status: 405, body: { detail: 'Method not allowed' } }
          : { status: 404, body: { detail: 'Not found' } };
      }

      // Repeated query keys (?tag=a&tag=b) become an array; a single key stays a string.
      const query: Record<string, unknown> = {};
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
        // REST мапит kind напрямую (без JSON-RPC-модели): invalid-params → 422, прочее → 500.
        const status = e instanceof CoreError && e.kind === 'invalid-params' ? 422 : 500;
        // CoreError messages are intentional (validation); unexpected handler errors → generic,
        // so internal detail (connection strings, stacks) never leaks to the client.
        const detail = e instanceof CoreError ? e.message : 'Internal error';
        return { status, body: { detail } };
      }
    },
  };
  return { http, format } as HttpProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> };
}