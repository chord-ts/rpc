// Client layer: protocol-specific constructors, the inverse composition of the server.
//   server: const api = jsonrpc(composer, { format }); fromSvelteKit(api, event)
//   client: import { jsonrpc } from '@chord-ts/rpc/client'
//           jsonrpc<typeof api>({ endpoint, format })  /  ({ socket, format })
// Names mirror the server bindings (jsonrpc/rest); the module is ./client. The generic argument is
// the SERVER binding type (protocol + services + format). The constructor derives services and format
// from it, guards the protocol (B extends projection) and the format (init.format vs endpoint format),
// and wire-transforms return types by the endpoint format. Transport is chosen by the init shape:
// endpoint → fetch (http), socket → ws (message). REST is http-only (init has no socket).
// Native errors (throw RpcError / Error+status), no cache/onError. notify/batch/stream — later.
//
// Frontend optimization: ESM, pure function exports, no top-level side effects → tree-shakeable
// (importing jsonrpc does not retain rest). Minification: method names are dynamic proxy strings
// (Service.method); default minifiers keep property names, but property mangling breaks addressing
// (same class of risk as server DI paramNames) — keep property mangling off or use explicit keys.

import type { Socket } from '../transport';
import type { Format } from '../format/types';
import { json } from '../format';
import { RpcError, ErrorCode } from '@/jsonrpc';
import type {
  HttpClientBinding, MessageClientBinding, JsonRpcProfile, CallFn,
  FetchClientInit, ClientInit, BindingServices, BindingFormat,
  RpcBinding, RestBinding, WireClient, OpenApiDoc,
} from './types';

// v1-клиент (deprecated) реэкспортируется alongside v2-конструкторов: client/RPC/Builder (v1)
// и jsonrpc/rest (v2) не пересекаются. Старый путь ./client сохранён, v2 без суффикса версии.
export * from '../v1/client';

// --- internal: JSON-RPC profile (envelope + unwrap) ---
// Request id — a short unique string from Web Crypto, no dependency. getRandomValues is available
// in browsers in any context (unlike randomUUID, which needs a secure context) and in Node ≥ 20.
// Random ids avoid collisions across clients/processes talking to one server; a per-process
// counter could clash on reconnect or when two clients share a socket.
function uid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (const b of bytes) id += b.toString(16).padStart(2, '0');
  return id;
}
function jsonRpcProfile(): JsonRpcProfile {
  const envelope = (method: string, input: unknown) => ({ jsonrpc: '2.0', method, params: input, id: uid() });
  // A 2xx reply must be a JSON-RPC envelope with a result member — an empty body or a foreign
  // JSON object ({"foo":1}) must not resolve as an undefined result.
  const resultOf = (body: { jsonrpc?: unknown; result?: unknown } | null): unknown => {
    if (!body || body.jsonrpc !== '2.0' || !('result' in body)) {
      throw RpcError.parseError('Invalid JSON-RPC response', { body });
    }
    return body.result;
  };
  const unwrap = (value: unknown): unknown => {
    const body = value as { error?: { code: number; message: string; data?: unknown } } | null;
    if (body?.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
    return resultOf(value as { jsonrpc?: unknown; result?: unknown } | null);
  };
  return {
    http: {
      build: (method, input) => ({ method: 'POST', url: '', body: envelope(method, input) }),
      parse: (res) => {
        const body = res.body as { error?: { code: number; message: string; data?: unknown }; detail?: string; message?: string } | null;
        if (body?.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
        // Non-2xx without an envelope (adapter parse error, auth on the user's route, HTML error
        // page) is still a failure — never resolve it as an undefined result. data mirrors v1:
        // { status, headers, body } with the raw text when the body was not the endpoint format.
        if (res.status < 200 || res.status >= 300) {
          const detail = body?.detail ?? body?.message ?? `HTTP ${res.status}`;
          throw new RpcError(ErrorCode.InternalError, detail, { status: res.status, headers: res.headers, body: res.body }, res.status);
        }
        return resultOf(res.body as { jsonrpc?: unknown; result?: unknown } | null);
      },
    },
    message: {
      build: (method, input) => envelope(method, input),
      parse: (reply) => unwrap(reply),
    },
  };
}

// --- internal: REST profile (manifest = OpenAPI document) ---
interface RestRoute {
  method: string;
  endpoint: string;
  path: string[];
  query: string[];
  // Body mode mirrors the server composite: 'whole' (array/scalar) travels under the `body` key;
  // 'flat' (object-like: object/record/union/intersection) picks every input field not consumed by
  // path/query; 'none' — no request body.
  bodyMode: 'none' | 'whole' | 'flat';
}
function restProfile(doc: OpenApiDoc): { http: HttpClientBinding } {
  const components = doc.components?.schemas ?? {};
  // Recursive/reused body schemas are hoisted to components.schemas — resolve a bare $ref root.
  const deref = (s: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    const ref = s?.$ref;
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      return components[ref.slice('#/components/schemas/'.length)] as Record<string, unknown> | undefined;
    }
    return s;
  };
  // A body is non-object (whole mode) only when its schema is definitely array/scalar. Object-like
  // schemas — type:object, properties, additionalProperties (record), or a union/intersection of
  // objects — flat-merge on the server, so the client must send flat fields, not a `body` wrapper.
  const isNonObject = (s: Record<string, unknown> | undefined): boolean => {
    const d = deref(s);
    if (!d) return false;
    if (typeof d.type === 'string' && d.type !== 'object') return true;
    const branches = (d.anyOf ?? d.oneOf) as Record<string, unknown>[] | undefined;
    if (branches) return branches.every(isNonObject);
    return false;
  };
  const routes: Record<string, RestRoute> = {};
  for (const [endpoint, ops] of Object.entries(doc.paths ?? {})) {
    for (const [verb, op] of Object.entries(ops)) {
      if (!op.operationId) continue;
      const params = op.parameters ?? [];
      const bodySchema = deref(op.requestBody?.content?.['application/json']?.schema as Record<string, unknown> | undefined);
      routes[op.operationId] = {
        method: verb.toUpperCase(),
        endpoint,
        path: params.filter((p) => p.in === 'path').map((p) => p.name),
        query: params.filter((p) => p.in === 'query').map((p) => p.name),
        bodyMode: bodySchema === undefined ? 'none' : isNonObject(bodySchema) ? 'whole' : 'flat',
      };
    }
  }
  return {
    http: {
      build: (method, input) => {
        const route = routes[method];
        if (!route) throw new Error(`No REST route for ${method}`);
        const flat = (input ?? {}) as Record<string, unknown>;
        let path = route.endpoint;
        for (const name of route.path) {
          const v = flat[name];
          // Missing path param must not silently become the literal "undefined" in the URL.
          if (v === undefined) throw new Error(`Missing path parameter "${name}" for ${method}`);
          path = path.replace(`{${name}}`, encodeURIComponent(String(v)));
        }
        const qs = new URLSearchParams();
        for (const name of route.query) {
          const v = flat[name];
          if (v === undefined) continue;
          // Array query → repeated keys (?tag=a&tag=b); the server parses declared array fields
          // back into arrays (single value included). An empty array sends no key → server [].
          if (Array.isArray(v)) for (const item of v) qs.append(name, String(item));
          else qs.set(name, String(v));
        }
        const query = qs.toString();
        let body: unknown;
        if (route.bodyMode === 'whole') {
          body = flat['body']; // array/scalar body travels under the `body` key
        } else if (route.bodyMode === 'flat') {
          // Mirror the server: every input field not consumed by path/query is body. Picking only
          // declared `properties` silently dropped record/union bodies (no properties in schema).
          const consumed = new Set([...route.path, ...route.query]);
          const obj: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(flat)) if (!consumed.has(k) && v !== undefined) obj[k] = v;
          body = obj;
        }
        return { method: route.method, url: query ? `${path}?${query}` : path, body };
      },
      // REST error — HTTP status + {detail}, not a JSON-RPC envelope. Native throw with status;
      // headers/raw body attached v1-style (an HTML error page stays readable in error.body).
      parse: (res) => {
        if (res.status >= 200 && res.status < 300) return res.body;
        const detail = (res.body as { detail?: string } | undefined)?.detail ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(detail), { status: res.status, headers: res.headers, body: res.body });
      },
    },
  };
}

// --- internal: transports (fetch / ws) ---
// HTTP error handling mirrors v1 defaultTransport, adapted to native throws: network failure →
// RpcError.serverError; redirect → location.assign in the browser, Error+data in SSR; non-2xx →
// headers + trimmed preview logged, body decoded best-effort (an HTML error page is not the
// endpoint format — keep the raw text instead of crashing on decode); 2xx decode failure →
// RpcError.parseError.
function fetchCall(endpoint: string, format: Format<any>, b: HttpClientBinding, doFetch: typeof fetch, headers?: Record<string, string>): CallFn {
  return async (method, input) => {
    const req = b.build(method, input);
    // rest profile builds path+query → join UNDER the endpoint (new URL would drop the prefix on
    // an absolute path and throw on a relative endpoint); jsonrpc (empty url) — the endpoint itself.
    const url = req.url ? `${endpoint.replace(/\/+$/, '')}${req.url.startsWith('/') ? '' : '/'}${req.url}` : endpoint;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: req.method,
        // form: multipart boundary ставит платформа — ручной content-type ломает тело.
        headers: { ...(format.unit === 'form' ? {} : { 'content-type': format.contentType }), ...headers },
        body: req.body === undefined ? undefined : format.encode(req.body),
      });
    } catch (e) {
      // Сетевой сбой (до ответа): нативная ошибка fetch, обёрнутая с сообщением и причиной.
      throw RpcError.serverError(e instanceof Error ? e.message : String(e), e);
    }
    // Редирект: fetch следует ему сам (follow). Редирект на ВАЛИДНЫЙ API-ответ (http→https,
    // trailing slash, балансировщик) — это обычный ответ: возвращаем результат. Навигация
    // (location.assign в браузере, ошибка с целью в SSR) — только когда финальный ответ не является
    // форматом эндпоинта (login-страница, HTML): явный 3xx без тела или decode-сбой redirected 2xx.
    const navigate = (): never => {
      if (typeof location !== 'undefined' && typeof location.assign === 'function') location.assign(res.url);
      throw Object.assign(new Error(`Redirected to ${res.url}`), {
        status: res.status,
        data: { status: res.status, location: res.url, redirected: true },
      });
    };
    if (res.status >= 300 && res.status < 400) navigate();
    // form: multipart парсит платформа (res.formData()). Не-multipart тело (страница ошибки
    // прокси/редиректа) читаем текстом — по content-type, чтобы не disturbить тело неудачным formData().
    const raw =
      format.unit === 'bytes'
        ? new Uint8Array(await res.arrayBuffer())
        : format.unit === 'form'
          ? (res.headers.get('content-type') ?? '').includes('multipart/form-data')
            ? await res.formData()
            : await res.text()
          : await res.text();
    if (!res.ok) {
      const resHeaders = Object.fromEntries(res.headers.entries());
      const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : '';
      // Log only the status by default: URL (query secrets), response headers and body preview
      // must not reach server logs (SSR). Full detail stays in error.data for the caller.
      console.error(`[chord] HTTP ${res.status} ${res.statusText}`);
      let value: unknown = text;
      try {
        value = raw ? format.decode(raw) : undefined;
      } catch {
        // тело — страница ошибки, не формат эндпоинта: сырой текст остаётся значением
      }
      return b.parse({ status: res.status, headers: resHeaders, body: value });
    }
    let value: unknown;
    try {
      value = raw ? format.decode(raw) : undefined;
    } catch (e) {
      if (res.redirected) navigate(); // 2xx после редиректа, но тело — не формат эндпоинта
      throw RpcError.parseError('Invalid response', { status: res.status, cause: e instanceof Error ? e.message : String(e) });
    }
    return b.parse({ status: res.status, body: value });
  };
}

/** WS: message projection, multiplexed by request id — parallel calls correlate correctly.
 * An error reply rejects the matching promise (b.parse throws RpcError); a close hook, when the
 * socket provides one, rejects all pending calls so none hangs forever. */
function wsCall(socket: Socket, format: Format<any>, b: MessageClientBinding, timeout?: number): CallFn {
  const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let closed = false;
  socket.onMessage((data) => {
    let reply: unknown;
    try {
      reply = format.decode(data);
    } catch {
      return; // malformed frame: no id to correlate
    }
    const id = (reply as { id?: string | number } | null)?.id;
    if (id == null) return;
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    try {
      slot.resolve(b.parse(reply));
    } catch (e) {
      slot.reject(e);
    }
  });
  socket.onClose?.(() => {
    closed = true;
    for (const slot of pending.values()) slot.reject(new Error('Socket closed'));
    pending.clear();
  });
  return (method, input) =>
    new Promise((resolve, reject) => {
      // A call after close must reject immediately — send on a closed socket may be a silent
      // no-op, leaving the promise pending forever (timeout is off by default).
      if (closed) {
        reject(new Error('Socket closed'));
        return;
      }
      const value = b.build(method, input) as { id: string | number };
      // Optional per-call timeout: a server that never replies must not hang the caller forever.
      const timer =
        timeout !== undefined
          ? setTimeout(() => {
              pending.delete(value.id);
              reject(new Error(`Request timed out after ${timeout}ms`));
            }, timeout)
          : undefined;
      const clear = () => {
        if (timer !== undefined) clearTimeout(timer);
      };
      pending.set(value.id, {
        resolve: (v) => {
          clear();
          resolve(v);
        },
        reject: (e) => {
          clear();
          reject(e);
        },
      });
      // A throwing send must not leave the slot pending forever (leak) — reject and clean up.
      try {
        socket.send(format.encode(value));
      } catch (e) {
        pending.delete(value.id);
        clear();
        reject(e);
      }
    });
}

// --- internal: typed proxy surface ---
function proxy(call: CallFn): any {
  const build = (path: string[]): any =>
    new Proxy(() => {}, {
      get: (_, prop) => {
        // awaiting an uncalled builder must not go to the network as a `...then` call.
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return build([...path, String(prop)]);
      },
      // Проводной контракт: позиционные аргументы — [a, b]; массив-как-значение — [[…]]
      // (одиночный array-аргумент оборачивается); объект/скаляр — как есть; без аргументов —
      // params опускается (void/any-методы вызываются как rpc.Svc.ping()).
      apply: (_, __, args) =>
        call(
          path.join('.'),
          args.length === 0 ? undefined : args.length === 1 ? (Array.isArray(args[0]) ? [args[0]] : args[0]) : args,
        ),
    });
  return build([]);
}

// --- public constructors: generic = server binding type; format guarded vs endpoint ---
/** JSON-RPC client. B extends MessageProtocol (protocol guard). Transport: endpoint (fetch) or socket (ws). */
export function jsonrpc<B extends RpcBinding>(init: ClientInit<BindingFormat<B>>): WireClient<BindingServices<B>, BindingFormat<B>> {
  const format: Format<any> = init.format ?? json;
  const profile = jsonRpcProfile();
  const call =
    'endpoint' in init
      ? fetchCall(init.endpoint, format, profile.http, init.fetch ?? fetch, init.headers)
      : wsCall(init.socket, format, profile.message, init.timeout);
  return proxy(call) as WireClient<BindingServices<B>, BindingFormat<B>>;
}

/** REST client. B extends HttpProtocol; http-only (init requires endpoint, no socket → REST × WS impossible).
 * doc — the OpenAPI manifest (the artifact the server serves at /openapi.json; deliver via load or import). */
export function rest<B extends RestBinding>(init: FetchClientInit<BindingFormat<B>> & { doc: OpenApiDoc }): WireClient<BindingServices<B>, BindingFormat<B>> {
  const format: Format<any> = init.format ?? json;
  const profile = restProfile(init.doc);
  const call = fetchCall(init.endpoint, format, profile.http, init.fetch ?? fetch, init.headers);
  return proxy(call) as WireClient<BindingServices<B>, BindingFormat<B>>;
}

export type {
  HttpClientBinding, MessageClientBinding, JsonRpcProfile, CallFn,
  FetchClientInit, WsClientInit, ClientInit, BindingServices, BindingFormat,
  RpcBinding, RestBinding, WireClient, OpenApiDoc, OpenApiOperation,
} from './types';