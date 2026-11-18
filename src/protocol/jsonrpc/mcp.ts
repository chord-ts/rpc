// MCP binding: JSON-RPC 2.0 profile over the registry. Lifecycle (initialize → notifications/
// initialized) + tools/list + tools/call + ping. Format codecs the JSON-RPC envelope (MCP fixes json).
// tools/list reuses the mcpTools generator; tools/call packs args via the shared packToolArgs seam.
// NOTE: tools capability only — resources/prompts/sampling not yet; see PROGRESS.

import type { Core } from '../../core/types';
import type { AnySchema, MessageBinding, MessageProtocol } from '../../types';
import type { ErrorObject, RPCRequest } from './types';
import { mcpTools } from '../../generate';
import { defaultSchemas, packToolArgs } from '../../schemas';
// MCP — JSON-RPC-профиль, не пир: провод и модель ошибок берём из соседнего jsonrpc.
import { toError, toWire } from './jsonrpc';
import { messageToHttp } from '../message';

export interface McpMeta {
  desc?: string;
  title?: string;
}

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];

export function mcp(
  core: Core<any>,
  opts?: { jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string } },
): MessageProtocol {
  const toJson = opts?.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  const result = (id: unknown, r: unknown) => ({ jsonrpc: '2.0', id, result: r });
  const message: MessageBinding = {
    async handle(value, ctx) {
      const body = (value ?? {}) as RPCRequest;
      const id = body.id ?? null;

      // Lifecycle: initialize handshake (protocolVersion negotiation + capabilities + serverInfo).
      if (body.method === 'initialize') {
        const params = (body.params ?? {}) as { protocolVersion?: string };
        const version = SUPPORTED_VERSIONS.includes(params.protocolVersion ?? '')
          ? params.protocolVersion!
          : PROTOCOL_VERSION;
        return result(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts?.info?.title ?? 'chord-mcp', version: opts?.info?.version ?? '1.0.0' },
        });
      }
      if (body.method === 'notifications/initialized') return null; // notification — no response
      if (body.method === 'ping') return result(id, {});

      if (body.method === 'tools/list') {
        return result(id, mcpTools(core, { jsonSchema: toJson }));
      }

      if (body.method === 'tools/call') {
        const { name, arguments: args } = (body.params ?? {}) as { name: string; arguments?: unknown };
        const endpoint = core.endpoints().find((e) => `${e.service}.${e.method}` === name);
        const params = endpoint?.contract ? packToolArgs(endpoint.contract, args, toJson) : args;
        // Ошибка исполнения тула — isError-контент (MCP spec), не JSON-RPC error.
        try {
          const v = await core.call(name, params ?? {}, { ctx });
          return result(id, { content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
        } catch (e) {
          return result(id, { content: [{ type: 'text', text: toError(e).message }], isError: true });
        }
      }

      // Other JSON-RPC methods — same envelope as jsonrpc.
      let v: unknown;
      let error: ErrorObject | undefined;
      try {
        v = await core.call(body.method, body.params, { ctx });
      } catch (e) {
        error = toError(e);
      }
      if (id == null) return null;
      return toWire(id, v, error);
    },
  };
  return { message, http: messageToHttp(message) };
}