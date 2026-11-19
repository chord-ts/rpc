// MCP-профиль ревизии 2026-07-28 (ПРЕДЛАГАЕМАЯ механика, дизайн-спайк). ОДНА фабрика для
// пользователя: mcp(composer, opts) → endpoint, который отдаёт generic-адаптеру http-проекцию.
// Собственного MCP-транспорта больше нет: fromSvelteKit(mcpEndpoint) — и всё.
//
// Что изменила ревизия (SEP-2575 / SEP-2322 / SEP-2567): протокол stateless (initialize/ping
// удалены, версия и capabilities в _meta каждого запроса), server/discover MUST, обязательный
// resultType, subscriptions/listen вместо GET-эндпоинта и resources/subscribe, серверных
// запросов нет (MRTR), сессии и Last-Event-ID удалены.
//
// ПОВЕРХНОСТЬ — граница «пользователь / под капотом»:
//   пользователь пишет: const e = mcp(composer, { info?, instructions?, resources? });
//                       export const POST = fromSvelteKit(e);
//                       e.publish({ kind: 'tools-changed' }) — из доменного кода, когда изменилось.
//   под капотом:        канал подписчиков (очередь, fan-out, регистрация/снятие, отмена),
//                       _meta и io.modelcontextprotocol/*, resultType, server/discover,
//                       tools/list + tools/call, subscriptions/listen (ack, agreed-subset,
//                       MUST NOT-фильтр, subscriptionId, graceful-финал), WIRE kind → notifications/*,
//                       POST-only/405, Origin/403, сверка заголовков + base64-сентинел, 202,
//                       коды -32020/-32021/-32022 и HTTP-статусы, CacheableResult.
//   в src после согласования: профиль → protocol/jsonrpc/mcp.ts (замена legacy 2025-06-18),
//                       HttpRequest (headers/signal) → types.ts, SSE-фрейминг → transport/.
//
// Почему publish, а не генератор: источник изменений — домен, а не таймер. Пользователь не
// пишет async-генератор, signal и cancellable-паузы; ожидание живёт внутри канала, который
// умеет прерываться по signal. Отмена поэтому prompt без всякой кооперации пользователя.

import { CoreError, ErrorCode, RpcError, defaultSchemas, mcpTools, packToolArgs } from '../../../src';
import type { AnySchema, Binding, Core, ErrorObject, HttpProtocol, RPCId, RPCRequest, TransportResponse } from '../../../src';
import type { HttpRequest } from './http';

export const MCP_VERSION = '2026-07-28';

// --- ПУБЛИЧНО: доменные события пользователя (без MCP-провода) ---

export type McpChange =
  | { kind: 'tools-changed' }
  | { kind: 'prompts-changed' }
  | { kind: 'resources-changed' }
  | { kind: 'resource-updated'; uri: string };

export interface McpOptions {
  info?: { name: string; version: string };
  instructions?: string;
  /** Сервер реально отдаёт resources: capability + подписки на uri. Default false. */
  resources?: boolean;
  /** CacheableResult (spec: обязательны на list/discover-результатах). */
  ttlMs?: number;
  cacheScope?: 'public' | 'private';
  supportedVersions?: string[];
  jsonSchema?: (s: AnySchema) => unknown;
  /** Политика Origin (spec MUST: присутствует и невалиден → 403). Default — same-origin. */
  origin?: (origin: string, url: string) => boolean;
}

/** Endpoint = http-проекция для generic-адаптера + push-ручка домена. */
export interface McpEndpoint extends HttpProtocol {
  /** Доменное изменение → подписчикам MCP. Провод, фильтрация и fan-out — внутри. */
  publish(change: McpChange): void;
  /** Graceful-завершение всех подписок (spec SHOULD: финальный ответ, затем закрытие). */
  close(): void;
}

// --- ПОД КАПОТОМ: провод ревизии ---

const META = 'io.modelcontextprotocol/';
const VERSION_KEY = `${META}protocolVersion`;
const CAPS_KEY = `${META}clientCapabilities`;
const SERVER_KEY = `${META}serverInfo`;
const SUB_KEY = `${META}subscriptionId`;

const McpCode = { HeaderMismatch: -32020, UnsupportedVersion: -32022 } as const;

type ListenFilter = {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  resourceSubscriptions?: string[];
};
type ListenType = keyof ListenFilter;

const WIRE: Record<McpChange['kind'], { method: string; type: ListenType }> = {
  'tools-changed': { method: 'notifications/tools/list_changed', type: 'toolsListChanged' },
  'prompts-changed': { method: 'notifications/prompts/list_changed', type: 'promptsListChanged' },
  'resources-changed': { method: 'notifications/resources/list_changed', type: 'resourcesListChanged' },
  'resource-updated': { method: 'notifications/resources/updated', type: 'resourceSubscriptions' },
};

// Спека: Mcp-Name обязателен для этих методов (таблица Standard Request Headers).
const NAME_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);
const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/;

function decodeHeader(raw: string): string | undefined {
  const m = BASE64_SENTINEL.exec(raw);
  if (!m) return /^[\t\x20-\x7e]*$/.test(raw) ? raw : undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

type Params = Record<string, unknown> & {
  _meta?: Record<string, unknown>;
  name?: string;
  uri?: string;
  arguments?: unknown;
  notifications?: ListenFilter;
};

export function mcp(core: Core<any>, opts: McpOptions = {}): McpEndpoint {
  const supported = opts.supportedVersions ?? [MCP_VERSION];
  const serverInfo = opts.info ?? { name: 'chord-mcp', version: '1.0.0' };
  const toJson = opts.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  const ttlMs = opts.ttlMs ?? 60_000;
  const cacheScope = opts.cacheScope ?? 'public';
  const allowOrigin = opts.origin ?? ((origin, url) => origin === new URL(url).origin);
  // Обещаем только то, что реально есть: resources — по флагу, prompts не реализованы.
  const honors: ListenType[] = opts.resources ? ['toolsListChanged', 'resourcesListChanged', 'resourceSubscriptions'] : ['toolsListChanged'];

  // --- канал подписчиков: очередь на подписку, fan-out, снятие при отмене ---
  // Один подписчик = один drain-цикл, поэтому один слот wake корректен (в прежнем спайке
  // session-очередь будила только последнего из нескольких читателей — второй голодал).
  type Subscriber = { agreed: ListenFilter; queue: McpChange[]; wake?: () => void; closed: boolean };
  const subs = new Set<Subscriber>();

  function publish(change: McpChange): void {
    for (const s of subs) {
      if (!honored(change, s.agreed)) continue; // spec MUST NOT: незатребованное не шлём
      s.queue.push(change);
      s.wake?.();
    }
  }

  function close(): void {
    for (const s of subs) {
      s.closed = true;
      s.wake?.();
    }
  }

  /** Ожидание внутри библиотеки — потому и прерывается по signal без участия пользователя. */
  async function* drain(s: Subscriber, signal: AbortSignal): AsyncIterable<McpChange> {
    const aborted = new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true }));
    try {
      for (;;) {
        while (s.queue.length) yield s.queue.shift()!;
        if (s.closed || signal.aborted) return;
        await Promise.race([aborted, new Promise<void>((r) => { s.wake = r; })]);
      }
    } finally {
      subs.delete(s);
      s.wake = undefined;
    }
  }

  // --- провод ---

  const ok = (id: RPCId, result: unknown) => ({
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      _meta: { [SERVER_KEY]: serverInfo },
      ...(typeof result === 'object' && result !== null ? result : { value: result }),
    },
  });
  const fail = (id: RPCId, code: number, message: string, status?: number, data?: unknown) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message, status, data } as ErrorObject,
  });

  function wireError(e: unknown): ErrorObject {
    if (e instanceof RpcError) return { code: e.code, message: e.message, data: e.data, status: e.status };
    if (e instanceof CoreError) {
      const code =
        e.kind === 'not-found' ? ErrorCode.MethodNotFound : e.kind === 'invalid-params' ? ErrorCode.InvalidParams : ErrorCode.InternalError;
      return { code, message: e.message, data: e.data, status: e.kind === 'not-found' ? 404 : undefined };
    }
    return { code: ErrorCode.InternalError, message: e instanceof Error ? e.message : String(e) };
  }

  function agree(filter: ListenFilter): ListenFilter {
    const out: ListenFilter = {};
    for (const key of ['toolsListChanged', 'promptsListChanged', 'resourcesListChanged'] as const) {
      if (filter[key] && honors.includes(key)) out[key] = true;
    }
    if (filter.resourceSubscriptions?.length && honors.includes('resourceSubscriptions')) {
      out.resourceSubscriptions = filter.resourceSubscriptions;
    }
    return out;
  }

  function honored(change: McpChange, agreed: ListenFilter): boolean {
    const type = WIRE[change.kind].type;
    if (type === 'resourceSubscriptions') {
      return change.kind === 'resource-updated' && (agreed.resourceSubscriptions ?? []).includes(change.uri);
    }
    return agreed[type] === true;
  }

  /** Ответ на subscriptions/listen — ПОТОК. Адаптер увидит AsyncIterable в body и откроет SSE. */
  async function* listen(id: RPCId, filter: ListenFilter, signal: AbortSignal): AsyncIterable<unknown> {
    const agreed = agree(filter);
    const sub: Subscriber = { agreed, queue: [], closed: false };
    subs.add(sub);
    try {
      yield {
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: { _meta: { [SUB_KEY]: id }, notifications: agreed },
      };
      for await (const change of drain(sub, signal)) {
        if (signal.aborted) return; // клиент ушёл: финальный ответ не шлём
        yield {
          jsonrpc: '2.0',
          method: WIRE[change.kind].method,
          params: {
            ...(change.kind === 'resource-updated' ? { uri: change.uri } : {}),
            _meta: { [SUB_KEY]: id },
          },
        };
      }
      if (signal.aborted) return;
      // Graceful closure (spec SHOULD): сервер сам завершил подписку → финальный ответ.
      yield { jsonrpc: '2.0', id, result: { resultType: 'complete', _meta: { [SUB_KEY]: id } } };
    } finally {
      subs.delete(sub);
    }
  }

  async function unary(msg: RPCRequest, params: Params, ctx: unknown): Promise<unknown> {
    const id = msg.id ?? null;
    try {
      if (msg.method === 'server/discover') {
        return ok(id, {
          supportedVersions: supported,
          capabilities: { tools: {}, ...(opts.resources ? { resources: {} } : {}) },
          instructions: opts.instructions,
          ttlMs,
          cacheScope,
        });
      }
      if (msg.method === 'tools/list') {
        return ok(id, { ...mcpTools(core, { jsonSchema: toJson }), ttlMs, cacheScope });
      }
      if (msg.method === 'tools/call') {
        const name = params.name as string;
        const endpoint = core.endpoints().find((e) => `${e.service}.${e.method}` === name);
        const args = endpoint?.contract ? packToolArgs(endpoint.contract, params.arguments, toJson) : params.arguments;
        try {
          const v = await core.call(name, args ?? {}, { ctx });
          return ok(id, { content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
        } catch (e) {
          return ok(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
        }
      }
      // Прочие методы — chord-расширение поверх реестра; _meta не аргумент метода.
      const { _meta, ...rest } = params;
      return ok(id, await core.call(msg.method, rest, { ctx }));
    } catch (e) {
      const err = wireError(e);
      return fail(id, err.code, err.message, err.status, err.data);
    }
  }

  /** Зеркалирование заголовков ↔ тело (spec: Server Validation) → 400 + -32020. */
  function headerMismatch(headers: Record<string, string>, msg: RPCRequest): string | undefined {
    const params = (msg.params ?? {}) as Params;
    const meta = params._meta ?? {};

    const version = headers['mcp-protocol-version'];
    if (version == null) return 'Missing required header MCP-Protocol-Version';
    const bodyVersion = meta[VERSION_KEY];
    if (bodyVersion !== undefined && version !== bodyVersion) {
      return `Header mismatch: MCP-Protocol-Version '${version}' does not match body '${String(bodyVersion)}'`;
    }
    const method = headers['mcp-method'];
    if (method == null) return 'Missing required header Mcp-Method';
    if (method !== msg.method) return `Header mismatch: Mcp-Method '${method}' does not match body '${msg.method}'`;

    if (NAME_METHODS.has(msg.method)) {
      const raw = headers['mcp-name'];
      if (raw == null) return 'Missing required header Mcp-Name';
      const name = decodeHeader(raw);
      if (name === undefined) return 'Malformed Mcp-Name header value';
      const expected = params.name ?? params.uri;
      if (name !== expected) return `Header mismatch: Mcp-Name '${name}' does not match body '${String(expected)}'`;
    }
    // Mcp-Param-*: кодировка/символы. Полная сверка требует x-mcp-header из inputSchema — открыто.
    for (const [key, raw] of Object.entries(headers)) {
      if (key.startsWith('mcp-param-') && decodeHeader(raw) === undefined) return `Malformed ${key} header value`;
    }
    return undefined;
  }

  const err = (status: number, id: unknown, code: number, message: string, data?: unknown): TransportResponse => ({
    status,
    body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } },
  });

  // --- http-проекция: её и берёт generic fromSvelteKit ---
  const http: Binding = {
    async handle(request, ctx): Promise<TransportResponse> {
      const req = request as HttpRequest;
      const headers = req.headers ?? {};

      // Один POST-эндпоинт. GET/DELETE прежних ревизий → 405; сессии/Last-Event-ID игнорируем.
      if (req.method !== 'POST') return err(405, null, ErrorCode.InvalidRequest, 'Method not allowed: the MCP endpoint accepts POST only');
      const origin = headers['origin'];
      if (origin && !allowOrigin(origin, req.url)) return err(403, null, ErrorCode.InvalidRequest, 'Forbidden origin');

      const body = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return err(400, null, ErrorCode.InvalidRequest, 'Invalid request: a single JSON-RPC message is required');
      }
      const msg = body as RPCRequest;
      if (typeof msg.method !== 'string') return err(400, null, ErrorCode.InvalidRequest, 'Invalid request: method is required');
      if ('result' in msg || 'error' in msg) return err(400, null, ErrorCode.InvalidRequest, 'Invalid request: clients must not send responses');

      const mismatch = headerMismatch(headers, msg);
      if (mismatch) return err(400, msg.id, McpCode.HeaderMismatch, mismatch);

      const params = (msg.params ?? {}) as Params;
      const meta = params._meta ?? {};
      const id = msg.id ?? null;

      // Legacy-клиент: initialize удалён. spec SHOULD — назвать поддерживаемые версии.
      if (msg.method === 'initialize') {
        return err(404, id, ErrorCode.MethodNotFound, `initialize was removed in ${MCP_VERSION}; supported: ${supported.join(', ')} — call server/discover`);
      }
      const missing = [VERSION_KEY, CAPS_KEY].filter((k) => meta[k] === undefined);
      if (missing.length) return err(400, id, ErrorCode.InvalidParams, `Missing required _meta: ${missing.join(', ')}`);
      const requested = meta[VERSION_KEY] as string;
      if (!supported.includes(requested)) {
        return err(400, id, McpCode.UnsupportedVersion, 'Unsupported protocol version', { supported, requested });
      }
      if (id == null) return { status: 202, body: null }; // notification → 202 без тела

      const signal = req.signal ?? new AbortController().signal;
      if (msg.method === 'subscriptions/listen') {
        return { status: 200, body: listen(id, params.notifications ?? {}, signal) };
      }

      const value = (await unary(msg, params, ctx)) as { error?: ErrorObject } | null;
      // error.status — транспортный статус из профиля; на провод уходит JSON-RPC error без него.
      if (value?.error && typeof value.error.status === 'number') {
        const { status, ...wire } = value.error;
        return { status, body: { ...value, error: wire } };
      }
      return { status: 200, body: value };
    },
  };

  return { http, publish, close };
}
