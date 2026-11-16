// Транспортный срез v2 — библиотечная механика (ПРЕДЛАГАЕМОЕ API, спайк).
// Registration-ядро (fn/типы) — реальный src/v2. Здесь три слоя поверх него:
//   ядро compose() (instantiate/call/notify/endpoints) → биндинги (jsonrpc/rest/mcp) → транспорты (from*).
// Протокол выбирается ЯВНО: fromSvelteKit(rest(composer), event). Транспорт не знает протокола.
// Ядро ПРОТОКОЛ-АГНОСТИЧНО: JSON-RPC-конверт (normalize/toWire/batch) живёт в биндинге jsonrpc,
// не в ядре. Фабрика названа нейтрально (compose, не toRPC) — она обслуживает все протоколы.
// В реальном src exec пока в ядре; обёртка тут прячет его и показывает целевое разделение.
//
// Прогон (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-transport.example.ts

import {
  fn,
  toRPC as coreToRPC,
  ErrorCode,
  type ServiceMap,
  type ToRPCOptions,
  type Instantiated,
  type Result,
  type RPCBody,
  type RPCRequest,
  type RPCResponse,
  type RPCId,
  type ErrorObject,
  type Contract,
  type AnySchema,
  type Middleware,
} from '../src/v2';

// Генераторы транзитивны протоколу: биндинги сами отдают стандартные эндпоинты
// (rest → /openapi.json + /docs + /redoc, jsonrpc → rpc.discover, mcp → tools/list).
// Обратная сторона — только type-импорт, runtime-цикла нет.
import { openapi, openrpc, mcpTools, packToolArgs } from './v2-generate.helpers';
import { flatToolSchema } from './v2-schemas.helpers';

export { fn, ErrorCode };
export type { Result, ErrorObject, Contract, AnySchema, Middleware, ServiceMap };

// --- ядро: протокол-агностичный шов (gasket-вербы + реестр), без знания протокола ---

/** Запись реестра. `contract` несёт in/out/use + нейтральные поля (description/summary/tags/…)
 * и протокольные (rest/mcp/…), переданные в fn. `null` — simple-эндпоинт без схемы. */
export interface Endpoint {
  service: string;
  method: string;
  contract: (Contract & Record<string, unknown>) | null;
}

/** Вендорный адаптер схем — один на композер. Под капотом разруливает все операции
 * с библиотекой валидации: JSON Schema для генераторов, плоские схемы для тулов,
 * обёртки скаляров. Пользовательский код не знает про zod/valibot напрямую. */
export interface SchemaAdapter {
  jsonSchema(schema: AnySchema): unknown;
  isObject(schema: AnySchema): boolean;
  /** Плоская объектная схема из частей (REST) + именованных доп. полей (авто-path). */
  flatObject(parts: AnySchema[], extra: Record<string, AnySchema>): AnySchema;
  /** Скаляр → { value: T } (MCP/LangChain требуют объектную схему). */
  wrapScalar(schema: AnySchema): AnySchema;
  string(): AnySchema;
}

/** Готовый агентский тул: вендорная схема + JSON Schema + вызов ядра (in-process). */
export interface AgentTool {
  name: string;
  description: string;
  /** Вендорная плоская схема — напр. DynamicStructuredTool.schema в LangChain. */
  schema: AnySchema;
  inputSchema: unknown;
  annotations?: Record<string, boolean>;
  invoke(args: unknown, ctx?: unknown): Promise<Result>;
  /** Готовый вызов для фреймворка: строковый результат (LangChain func). */
  func(args: unknown): Promise<string>;
}

/** Протокол-агностичное ядро. Никакого exec/конверта — только вербы и реестр.
 * JSON-RPC/REST/MCP строят свои конверты поверх call/notify/endpoints. */
export interface Core<S extends ServiceMap> {
  instantiate(ctx: unknown): Instantiated<S>;
  call(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<Result>;
  notify(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<void>;
  endpoints(): readonly Endpoint[];
  /** Зарегистрированный вендорный адаптер — генераторы и биндинги берут его отсюда. */
  schemas: SchemaAdapter;
  /** Готовые тулы для агентских фреймворков (LangChain и аналоги), без провода. */
  tools(): AgentTool[];
}

function deriveEndpoints<S extends ServiceMap>(services: S): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [service, Ctor] of Object.entries(services)) {
    for (const [key, contract] of Object.entries(Ctor)) {
      if (key.startsWith('$') && contract && typeof contract === 'object' && 'in' in contract) {
        out.push({ service, method: key.slice(1), contract: contract as Contract & Record<string, unknown> });
      }
    }
    for (const method of Object.getOwnPropertyNames((Ctor as { prototype: object }).prototype)) {
      if (method === 'constructor' || out.some((e) => e.service === service && e.method === method)) continue;
      out.push({ service, method, contract: null });
    }
  }
  return out;
}

/** Нейтральные опции ядра (inject/use). Имя без RPC — ядро обслуживает все протоколы. */
export type ComposeOptions<S extends ServiceMap> = ToRPCOptions<S>;

// --- вендорный адаптер по умолчанию: generic ~standard, без знания zod ---
// Работает с любой ~standard-библиотекой; вендорный класс (ZodAdapter) даёт более
// точные операции (нативные zod-схемы для LangChain вместо обёрток).

const std = (s: AnySchema) =>
  (s as unknown as { '~standard': { jsonSchema?: (x: AnySchema) => unknown } })['~standard'];

export const defaultSchemas: SchemaAdapter = {
  jsonSchema: (s) => std(s).jsonSchema?.(s) ?? {},
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
          // Части — stripping-объекты: каждая берёт из плоского значения свои поля.
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

/** Фабрика ядра: регистрирует сервисы, отдаёт протокол-агностичный шов.
 * Не «toRPC» — JSON-RPC лишь один из биндингов поверх этого ядра.
 * schemas — один вендорный адаптер на всё: генераторы, биндинги и tools() берут его отсюда. */
export function compose<S extends ServiceMap>(
  services: S,
  options: ComposeOptions<S> & { schemas?: SchemaAdapter },
): Core<S> {
  const rpc = coreToRPC(services, options);
  const registry = deriveEndpoints(services);
  const schemas = options.schemas ?? defaultSchemas;

  function tools(): AgentTool[] {
    const descriptors = mcpTools(core, {}).tools as Array<Omit<AgentTool, 'schema' | 'invoke' | 'func'>>;
    return registry
      .filter((e) => e.contract)
      .map((e, i) => {
        const c = e.contract!;
        const name = `${e.service}.${e.method}`;
        const invoke = (args: unknown, ctx?: unknown) =>
          core.call(name, packToolArgs(c, args, schemas.jsonSchema), { ctx });
        return {
          ...descriptors[i],
          schema: flatToolSchema(c, schemas),
          invoke,
          func: async (args: unknown) => {
            const r = await invoke(args);
            return JSON.stringify(r.ok ? r.value : r.error);
          },
        };
      });
  }

  const core: Core<S> = {
    instantiate: rpc.instantiate,
    // call/notify внутри опираются на exec текущего src; наружу конверт не торчит.
    async call(method, params, opts) {
      const wire = (await rpc.exec({ method, params, id: 1 }, opts)) as RPCResponse;
      return wire.error ? { ok: false, error: wire.error } : { ok: true, value: wire.result };
    },
    async notify(method, params, opts) {
      await rpc.exec({ method, params }, opts);
    },
    endpoints: () => registry,
    schemas,
    tools,
  };
  return core;
}

// --- declaration sugar: протокол виден в декларации ---
// fn({ in, out }) — JSON-RPC/MCP. get/post/…(path, { path?, query?, body?, out }) — REST:
// параметры объявлены частями, как в FastAPI. Тип обработчика собирается из частей:
// path (или имена из шаблона → string) & query & body. Ядро не меняется: сахар синтезирует
// `in` — composite-схему, которая валидирует срезы { path, query, body } и сливает результат.

export interface RestMeta {
  method: string; // 'GET' | 'POST' | …
  endpoint: string; // path-шаблон: '/items/{item_id}'
  status?: number; // статус успеха (default 200)
}

type MaybeArray<T> = T | T[];

/** REST-контракт: части вместо плоского in. path опционален — без схемы имена
 * из шаблона типизируются как string (значения из URL и так строки).
 * resp — карта статусов, как responses в FastAPI: { 201: schema, 409: schema }.
 * Схема статуса успеха (status ?? 200) — тип возврата обработчика и валидатор out. */
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

// Имена path-параметров выводятся из строкового литерала шаблона.
type PathKeys<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | PathKeys<R> : never;
type AutoPath<S extends string> = { [K in PathKeys<S>]: string };

type PartOut<S> = S extends AnySchema<infer O> ? O : unknown;
type RestIn<C extends RestContract, P extends string> = (C['path'] extends AnySchema<any>
  ? PartOut<C['path']>
  : AutoPath<P>) &
  PartOut<C['query']> &
  PartOut<C['body']>;

// Статус успеха: явно объявленный status, иначе 200. Его схема в resp — возврат обработчика.
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

/** Composite-схема: вендор-агностичный `in`, синтезированный из частей.
 * Валидирует каждый срез своей схемой (часть без схемы проезжает как есть),
 * сливает распарсенные значения в один объект — вход обработчика. */
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

/** Generic REST-декларация. Имя http (не rest), чтобы не clashed с биндингом rest(composer).
 * status, написанный плоско, поднимается в rest — биндинг/генераторы читают rest-namespace.
 * Схема статуса успеха из resp становится `out` — ядро валидирует возврат обработчика. */
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

// --- формат: codec-пара (обобщён до unknown — годится и JSON-RPC, и REST, и MCP) ---

export interface Format {
  contentType: string;
  decode(raw: string): unknown;
  encode(value: unknown): string;
}

export const json: Format = {
  contentType: 'application/json',
  decode: (raw) => JSON.parse(raw),
  encode: (value) => JSON.stringify(value),
};

// --- транспортный шов (структурный, zero-dep: ядру не нужны DOM/node-типы) ---

export interface TransportRequest {
  method: string; // HTTP-метод
  url: string; // полный URL (pathname + query)
  text(): Promise<string>;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

/** Биндинг протокола: сырой запрос + ctx → сырой ответ. Транспорт выбирает биндинг явно. */
export interface Binding {
  handle(req: TransportRequest, ctx?: unknown): Promise<TransportResponse>;
}

const headersOf = (format: Format) => ({ 'content-type': format.contentType });

// --- транспорты: тонкие, protocol-agnostic (только гоняют байты в биндинг) ---

/** SvelteKit / любой fetch-runtime: event.request + event.locals → Response. */
export async function fromSvelteKit(
  binding: Binding,
  event: { request: TransportRequest; locals?: unknown },
): Promise<Response> {
  const r = await binding.handle(event.request, event.locals);
  return new Response(r.body, { status: r.status, headers: r.headers });
}

// Express: структурные req/res. express.json() парсит тело — text() отдаёт его обратно.
interface ExpressReq {
  method: string;
  url: string;
  body?: unknown;
  ctx?: unknown;
}
interface ExpressRes {
  status(code: number): ExpressRes;
  set(field: string, value: string): ExpressRes;
  send(body?: string | null): ExpressRes;
}
export async function fromExpress(binding: Binding, req: ExpressReq, res: ExpressRes): Promise<void> {
  const transportReq: TransportRequest = {
    method: req.method,
    url: `http://localhost${req.url}`,
    text: async () => JSON.stringify(req.body ?? null),
  };
  const r = await binding.handle(transportReq, req.ctx);
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.set(k, v);
  res.send(r.body);
}

// --- биндинг JSON-RPC 2.0: конверт (normalize/toWire/batch) живёт ЗДЕСЬ, не в ядре ---

function toWire(result: Result, id: RPCId): RPCResponse {
  return result.ok
    ? { jsonrpc: '2.0', id, result: result.value }
    : { jsonrpc: '2.0', id, error: result.error };
}

export function jsonrpc(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string; description?: string } },
): Binding {
  const format = opts?.format ?? json;
  let discovery: object | undefined; // ленивая генерация один раз
  return {
    async handle(req, ctx) {
      let body: RPCBody;
      try {
        body = format.decode(await req.text()) as RPCBody;
      } catch {
        const parseError: RPCResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: ErrorCode.ParseError, message: 'Parse error' },
        };
        return { status: 200, headers: headersOf(format), body: format.encode(parseError) };
      }
      // normalize → по каждому вызову core.call → toWire; notification (без id) — без ответа.
      // rpc.discover — стандартный метод OpenRPC: отдаёт сгенерированный документ.
      const calls = Array.isArray(body) ? body : [body];
      const out: RPCResponse[] = [];
      for (const c of calls) {
        const result: Result =
          c.method === 'rpc.discover'
            ? { ok: true, value: (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info })) }
            : await core.call(c.method, c.params, { ctx });
        if (c.id != null) out.push(toWire(result, c.id));
      }
      const wire = Array.isArray(body) ? out : out[0];
      if (wire === undefined) return { status: 204, headers: {}, body: null };
      return { status: 200, headers: headersOf(format), body: format.encode(wire) };
    },
  };
}

// --- биндинг REST (FastAPI-подобный: метод + path-шаблон + параметры из схемы) ---

interface RestRoute extends RestMeta {
  service: string;
  handler: string; // имя метода сервиса; `method` занят HTTP-глаголом из RestMeta
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

/** REST: роуты из endpoints().rest; параметры упакованы срезами { path, query, body } —
 * composite-схема `in` валидирует каждый срез своей частью и сливает вход обработчика.
 * Result → HTTP-статус (error.status → HTTP).
 * Docs ТРАНЗИТИВНЫ протоколу (как в FastAPI): GET /openapi.json, /docs (Swagger UI), /redoc
 * генерируются из того же реестра и включены по умолчанию; opts.docs=false выключает. */
export function rest(
  core: Core<any>,
  opts?: {
    format?: Format;
    jsonSchema?: (s: AnySchema) => unknown;
    info?: { title: string; version: string; description?: string };
    docs?: boolean | { openapi?: string; swagger?: string; redoc?: string };
  },
): Binding {
  const format = opts?.format ?? json;
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
  let spec: string | undefined; // ленивая генерация один раз
  const html = (body: string): TransportResponse => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  });

  return {
    async handle(req, ctx) {
      const url = new URL(req.url);

      // Стандартные эндпоинты протокола — до роутинга методов.
      if (docs && req.method === 'GET') {
        if (url.pathname === docs.openapi) {
          spec ??= JSON.stringify(openapi(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }), null, 2);
          return { status: 200, headers: headersOf(format), body: spec };
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
        return { status: 404, headers: headersOf(format), body: format.encode({ detail: 'Not found' }) };
      }

      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      let body: unknown = {};
      const text = await req.text();
      if (text && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        try {
          body = format.decode(text);
        } catch {
          return { status: 400, headers: headersOf(format), body: format.encode({ detail: 'Parse error' }) };
        }
      }
      // Срезы вместо слияния: каждая часть валидируется своей схемой (composite `in`).
      // query из URL — строки; числовые query-поля объявляются z.coerce.number().
      const params = { path: pathValues, query, body };
      const result = await core.call(`${route.service}.${route.handler}`, params, { ctx });
      if (result.ok) {
        return { status: route.status ?? 200, headers: headersOf(format), body: format.encode(result.value) };
      }
      // FastAPI-подобно: ошибка валидации → 422, прочее — error.status или 500.
      const status = result.error.status ?? (result.error.code === ErrorCode.InvalidParams ? 422 : 500);
      return {
        status,
        headers: headersOf(format),
        body: format.encode({ detail: result.error.message }),
      };
    },
  };
}

// --- биндинг MCP (JSON-RPC 2.0: tools/list + tools/call поверх реестра) ---

export interface McpMeta {
  desc?: string;
  title?: string;
}

function rpcResult(format: Format, id: RPCId, result: unknown): TransportResponse {
  const wire: RPCResponse = { jsonrpc: '2.0', id, result };
  return { status: 200, headers: headersOf(format), body: format.encode(wire) };
}

export function mcp(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown },
): Binding {
  const format = opts?.format ?? json;
  // Конвертер — из зарегистрированного адаптера; opts.jsonSchema — точечный override.
  const toJson = opts?.jsonSchema ?? core.schemas.jsonSchema;
  return {
    async handle(req, ctx) {
      const body = format.decode(await req.text()) as RPCRequest;
      const id = body.id ?? null;

      if (body.method === 'tools/list') {
        // Тот же генератор, что и standalone mcpTools() — один источник артефакта.
        return rpcResult(format, id, mcpTools(core, { jsonSchema: toJson }));
      }

      if (body.method === 'tools/call') {
        const { name, arguments: args } = (body.params ?? {}) as { name: string; arguments?: unknown };
        // REST → срезы, fn-скаляр → распаковка { value }: общий шов с агентскими тулами.
        const endpoint = core.endpoints().find((e) => `${e.service}.${e.method}` === name);
        const params = endpoint?.contract ? packToolArgs(endpoint.contract, args, toJson) : args;
        const r = await core.call(name, params ?? {}, { ctx });
        const content = [
          { type: 'text', text: r.ok ? JSON.stringify(r.value) : r.error.message },
        ];
        return rpcResult(format, id, { content, isError: !r.ok });
      }

      // Прочие JSON-RPC методы (initialize, ping, …) — тот же конверт, что у jsonrpc.
      const result = await core.call(body.method, body.params, { ctx });
      if (id == null) return { status: 204, headers: {}, body: null };
      return { status: 200, headers: headersOf(format), body: format.encode(toWire(result, id)) };
    },
  };
}