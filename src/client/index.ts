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

import type { ServiceMap } from '../core/types';
import type { Socket } from '../transport';
import type { Format } from '../format/types';
import { json } from '../format';
import { RpcError } from '../protocol/jsonrpc';
import type {
  HttpClientBinding, MessageClientBinding, JsonRpcProfile, CallFn,
  FetchClientInit, WsClientInit, ClientInit, BindingServices, BindingFormat,
  RpcBinding, RestBinding, WireClient, OpenApiDoc,
} from './types';

// v1-клиент (deprecated) реэкспортируется alongside v2-конструкторов: client/RPC/Builder (v1)
// и jsonrpc/rest (v2) не пересекаются. Старый путь ./client сохранён, v2 без суффикса версии.
export * from '../v1/client';

// --- internal: JSON-RPC profile (envelope + unwrap) ---
function jsonRpcProfile(): JsonRpcProfile {
  let id = 0;
  const envelope = (method: string, input: unknown) => ({ jsonrpc: '2.0', method, params: input, id: ++id });
  const unwrap = (value: unknown): unknown => {
    const body = value as { result?: unknown; error?: { code: number; message: string; data?: unknown } } | null;
    if (body?.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
    return body?.result;
  };
  return {
    http: {
      build: (method, input) => ({ method: 'POST', url: '', body: envelope(method, input) }),
      parse: (res) => unwrap(res.body),
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
  body: string[];
}
function restProfile(doc: OpenApiDoc): { http: HttpClientBinding } {
  const routes: Record<string, RestRoute> = {};
  for (const [endpoint, ops] of Object.entries(doc.paths ?? {})) {
    for (const [verb, op] of Object.entries(ops)) {
      if (!op.operationId) continue;
      const params = op.parameters ?? [];
      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      routes[op.operationId] = {
        method: verb.toUpperCase(),
        endpoint,
        path: params.filter((p) => p.in === 'path').map((p) => p.name),
        query: params.filter((p) => p.in === 'query').map((p) => p.name),
        body: Object.keys(bodySchema?.properties ?? {}),
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
        for (const name of route.path) path = path.replace(`{${name}}`, encodeURIComponent(String(flat[name])));
        const qs = new URLSearchParams();
        for (const name of route.query) if (flat[name] !== undefined) qs.set(name, String(flat[name]));
        const body: Record<string, unknown> = {};
        for (const name of route.body) if (flat[name] !== undefined) body[name] = flat[name];
        const query = qs.toString();
        return { method: route.method, url: query ? `${path}?${query}` : path, body: route.body.length ? body : undefined };
      },
      // REST error — HTTP status + {detail}, not a JSON-RPC envelope. Native throw with status.
      parse: (res) => {
        if (res.status >= 200 && res.status < 300) return res.body;
        const detail = (res.body as { detail?: string } | undefined)?.detail ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(detail), { status: res.status, body: res.body });
      },
    },
  };
}

// --- internal: transports (fetch / ws) ---
function fetchCall(endpoint: string, format: Format<any>, b: HttpClientBinding, doFetch: typeof fetch, headers?: Record<string, string>): CallFn {
  return async (method, input) => {
    const req = b.build(method, input);
    // rest profile builds path+query → resolve from endpoint; jsonrpc (empty url) — the endpoint itself.
    const url = req.url ? new URL(req.url, endpoint).toString() : endpoint;
    const res = await doFetch(url, {
      method: req.method,
      headers: { 'content-type': format.contentType, ...headers },
      body: req.body === undefined ? undefined : format.encode(req.body),
    });
    const raw = format.unit === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    const value = raw ? format.decode(raw) : undefined;
    return b.parse({ status: res.status, body: value });
  };
}

/** WS: message projection, serial calls (one in-flight); multiplexing by id — later, as on server. */
function wsCall(socket: Socket, format: Format<any>, b: MessageClientBinding): CallFn {
  let pending: ((reply: unknown) => void) | null = null;
  socket.onMessage((data) => {
    const reply = format.decode(data);
    const resolve = pending;
    pending = null;
    resolve?.(reply);
  });
  return (method, input) =>
    new Promise((resolve) => {
      const value = b.build(method, input);
      pending = (reply) => resolve(b.parse(reply));
      socket.send(format.encode(value));
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
      // One argument — single input (object/scalar); several — positional array (simple endpoints).
      apply: (_, __, args) => call(path.join('.'), args.length === 1 ? args[0] : args),
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
      : wsCall(init.socket, format, profile.message);
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