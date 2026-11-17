// REST protocol: declaration sugar (get/post/…, FastAPI-style parts) + binding (routing, slices,
// resp status map, transitive docs endpoints). fn stays in core; REST sugar lives here.
// Format codecs only the HTTP body; status/headers/path are protocol+transport, not Format.

import { fn } from '../core';
import { CoreError, type Core, type MaybeArray, type Middleware } from '../core/types';
import type { AnySchema, Binding, RestMeta, TransportResponse } from '../types';
import { openapi } from '../generate';

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

type RestFn<C extends RestContract, P extends string> = C & {
  in: AnySchema<RestIn<C, P>>;
  out?: AnySchema<RespOut<C>>;
  fn: (input: RestIn<C, P>) => Promise<RespOut<C>>;
  rest: RestMeta & { endpoint: P };
};

/** Composite schema: vendor-agnostic `in` synthesized from parts. Validates each slice with its
 * part (a part without a schema passes through), merges parsed values into one handler input. */
function composite(c: RestContract): AnySchema<any> {
  const parts: [string, AnySchema<any> | undefined][] = [
    ['path', c.path],
    ['query', c.query],
    ['body', c.body],
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
            Object.assign(merged, slice as object);
            continue;
          }
          const r = await schema['~standard'].validate(slice);
          if ('issues' in r) issues.push(...r.issues);
          else Object.assign(merged, r.value as object);
        }
        return issues.length > 0 ? { issues } : { value: merged };
      },
    },
  };
}

/** Generic REST declaration. Named http (not rest) to avoid clashing with the rest(composer) binding.
 * Flat `status` is hoisted into rest; the success-status schema from resp becomes `out`. */
export function http<P extends string, C extends RestContract>(meta: RestMeta & { endpoint: P }, c: C): RestFn<C, P> {
  const rest = c.status !== undefined ? { ...meta, status: c.status } : meta;
  const out = c.resp?.[c.status ?? 200];
  return { ...c, in: composite(c), ...(out ? { out } : {}), rest } as unknown as RestFn<C, P>;
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
  const pattern = template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    params.push(name);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${pattern}$`), params };
}

/** REST: routes from endpoints().rest; params packed as slices { path, query, body } (composite `in`
 * validates each slice). Native errors → HTTP status (validation → 422). Docs are transitive
 * (FastAPI-style): GET /openapi.json, /docs (Swagger UI), /redoc generated from the registry, on by default. */
export function rest(
  core: Core<any>,
  opts?: {
    jsonSchema?: (s: AnySchema) => unknown;
    info?: { title: string; version: string; description?: string };
    docs?: boolean | { openapi?: string; swagger?: string; redoc?: string };
  },
): Binding {
  const routes: RestRoute[] = [];
  for (const e of core.endpoints()) {
    const meta = e.contract?.rest as RestMeta | undefined;
    if (!meta) continue;
    const { regex, params } = compilePath(meta.endpoint);
    routes.push({ ...meta, service: e.service, handler: e.method, regex, pathParams: params });
  }

  const docs =
    opts?.docs === false
      ? undefined
      : {
          openapi: '/openapi.json',
          swagger: '/docs',
          redoc: '/redoc',
          ...(typeof opts?.docs === 'object' ? opts.docs : {}),
        };
  let spec: string | undefined; // lazy, generated once
  // docs — не-negotiated ответы: raw-escape, адаптер не прогоняет их через кодек формата.
  const html = (body: string): TransportResponse => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    raw: true,
  });

  return {
    async handle(req, ctx) {
      const url = new URL(req.url);

      // Standard protocol endpoints — before method routing.
      if (docs && req.method === 'GET') {
        if (url.pathname === docs.openapi) {
          spec ??= JSON.stringify(openapi(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }), null, 2);
          return { status: 200, headers: { 'content-type': 'application/json' }, body: spec, raw: true };
        }
        if (url.pathname === docs.swagger) {
          return html(
            `<!doctype html><html><head><meta charset="utf-8">` +
              `<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>` +
              `<body><div id="swagger-ui"></div>` +
              `<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>` +
              `<script>SwaggerUIBundle({ url: ${JSON.stringify(docs.openapi)}, dom_id: '#swagger-ui' })</script>` +
              `</body></html>`,
          );
        }
        if (url.pathname === docs.redoc) {
          return html(
            `<!doctype html><html><head><meta charset="utf-8"></head>` +
              `<body><redoc spec-url=${JSON.stringify(docs.openapi)}></redoc>` +
              `<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>` +
              `</body></html>`,
          );
        }
      }

      let route: RestRoute | undefined;
      let pathValues: Record<string, string> = {};
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.regex);
        if (m) {
          route = r;
          pathValues = Object.fromEntries(r.pathParams.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
          break;
        }
      }
      if (!route) {
        return { status: 404, body: { detail: 'Not found' } };
      }

      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
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
        const detail = e instanceof Error ? e.message : String(e);
        return { status, body: { detail } };
      }
    },
  };
}