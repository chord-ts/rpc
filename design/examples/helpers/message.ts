// Message-шов — вариант B (ПРЕДЛАГАЕМЫЕ контракты, дизайн-спайк). Открывает WS/stream-трек.
// Идея: самоадресуемые протоколы (jsonrpc/mcp) знают только ЗНАЧЕНИЯ — метод внутри конверта
// (body.method), транспорт им не нужен. Поэтому их контракт транспорт-нейтральный:
//     MessageBinding.handle(value, ctx) => value | null   (null = нет ответа, notification)
// HTTP-адаптер оборачивает message-биндинг в HTTP-шов (method/url/status), WS-адаптер — во фреймы.
// REST НЕ тащим в message-контракт: он законно HTTP-связан (роутинг по method+path) и остаётся
// на src Binding (TransportRequest). Протокол один, транспорт-нейтральность явная, без dummy-полей.
//
// Конверт/ошибки/генерация переиспользуются из src (toWire/toError/openrpc/mcpTools/packToolArgs).
//
// Прогон типов (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-message.example.ts

import {
  ErrorCode,
  json,
  type Binding,
  type Core,
  type Format,
  type RPCBody,
  type RPCRequest,
  type RPCResponse,
} from '../../../src';
import { toError, toWire } from '../../../src/protocol/jsonrpc/jsonrpc';
import { mcpTools, openrpc } from '../../../src/generate';
import { defaultSchemas, packToolArgs } from '../../../src/schemas';

// --- транспорт-нейтральный контракт самоадресуемых протоколов ---

export interface MessageBinding {
  /** value — распарсенный конверт (работа адаптера×формата); null — нет ответа (notification). */
  handle(value: unknown, ctx?: unknown): Promise<unknown | null>;
}

// --- jsonrpc над message-шовом (batch/discover сохранены, конверт из src) ---

export function jsonrpcMessage(
  core: Core<any>,
  opts?: { jsonSchema?: (s: any) => unknown; info?: { title: string; version: string; description?: string } },
): MessageBinding {
  let discovery: object | undefined;
  return {
    async handle(value, ctx): Promise<unknown | null> {
      const body = value as RPCBody;
      if (body == null) {
        return { jsonrpc: '2.0', id: null, error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' } };
      }
      const calls = Array.isArray(body) ? body : [body];
      const baseCtx = (ctx ?? {}) as Record<string, unknown>;
      const out: RPCResponse[] = [];
      for (const c of calls) {
        let v: unknown;
        let error;
        try {
          v =
            c.method === 'rpc.discover'
              ? (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }))
              : await core.call(c.method, c.params, { ctx: { ...baseCtx } });
        } catch (e) {
          error = toError(e);
        }
        if (c.id != null) out.push(toWire(c.id, v, error));
      }
      if (Array.isArray(body)) return out.length ? out : null; // batch из одних notification → null
      return out[0] ?? null;
    },
  };
}

// --- mcp над message-шовом (handshake/tools сохранены) ---

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];

export function mcpMessage(
  core: Core<any>,
  opts?: { jsonSchema?: (s: any) => unknown; info?: { title: string; version: string } },
): MessageBinding {
  const toJson = opts?.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  const result = (id: unknown, r: unknown) => ({ jsonrpc: '2.0', id, result: r });
  return {
    async handle(value, ctx): Promise<unknown | null> {
      const body = (value ?? {}) as RPCRequest;
      const id = body.id ?? null;

      if (body.method === 'initialize') {
        const params = (body.params ?? {}) as { protocolVersion?: string };
        const version = SUPPORTED_VERSIONS.includes(params.protocolVersion ?? '') ? params.protocolVersion! : PROTOCOL_VERSION;
        return result(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts?.info?.title ?? 'chord-mcp', version: opts?.info?.version ?? '1.0.0' },
        });
      }
      if (body.method === 'notifications/initialized') return null;
      if (body.method === 'ping') return result(id, {});
      if (body.method === 'tools/list') return result(id, mcpTools(core, { jsonSchema: toJson }));

      if (body.method === 'tools/call') {
        const { name, arguments: args } = (body.params ?? {}) as { name: string; arguments?: unknown };
        const endpoint = core.endpoints().find((e) => `${e.service}.${e.method}` === name);
        const params = endpoint?.contract ? packToolArgs(endpoint.contract, args, toJson) : args;
        try {
          const v = await core.call(name, params ?? {}, { ctx });
          return result(id, { content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
        } catch (e) {
          return result(id, { content: [{ type: 'text', text: toError(e).message }], isError: true });
        }
      }

      let v: unknown;
      let error;
      try {
        v = await core.call(body.method, body.params, { ctx });
      } catch (e) {
        error = toError(e);
      }
      if (id == null) return null;
      return toWire(id, v, error);
    },
  };
}

// --- HTTP-адаптер: оборачивает message-биндинг в src HTTP-шов (Binding) ---
// Дальше работает штатный fromSvelteKit/fromExpress с format-ручкой. method/url — из HTTP-запроса,
// status 200/204 — из наличия ответа. REST сюда не оборачивается (он сам HTTP-биндинг).

export function messageToHttp(mb: MessageBinding): Binding {
  return {
    async handle(req, ctx) {
      const value = await mb.handle(req.body, ctx);
      return value == null ? { status: 204, body: null } : { status: 200, body: value };
    },
  };
}

// --- WS-адаптер: message-биндинг ↔ фреймы сокета. Format codec'ит фрейм (text/bytes) ---
// null-ответ (notification) → фрейм не шлётся. Серверный push (stream) — отдельный глагол, позже.

export interface Socket {
  send(data: string | Uint8Array): void;
  onMessage(handler: (data: string | Uint8Array) => void | Promise<void>): void;
}

export function wsFromMessage(mb: MessageBinding, socket: Socket, opts: { format?: Format<any> } = {}): void {
  const format = opts.format ?? json;
  socket.onMessage(async (data) => {
    const value = format.decode(data); // фрейм → значение
    const reply = await mb.handle(value);
    if (reply != null) socket.send(format.encode(reply)); // значение → фрейм; null → не слать
  });
}