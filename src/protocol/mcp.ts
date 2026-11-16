// MCP binding: JSON-RPC 2.0 profile over the registry. Lifecycle (initialize → notifications/
// initialized) + tools/list + tools/call + ping. Format codecs the JSON-RPC envelope (MCP fixes json).
// tools/list reuses the mcpTools generator; tools/call packs args via the shared packToolArgs seam.
// NOTE: tools capability only — resources/prompts/sampling not yet; see PROGRESS.

import type { AnySchema, Binding, Core, Format, RPCRequest } from '../types';
import { json as jsonFormat } from '../format';
import { mcpTools } from '../generate';
import { defaultSchemas, packToolArgs } from '../schemas';
import { headersOf, rpcResult, toWire } from './shared';

export interface McpMeta {
  desc?: string;
  title?: string;
}

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];

export function mcp(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string } },
): Binding {
  const format = opts?.format ?? jsonFormat;
  const toJson = opts?.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  return {
    async handle(req, ctx) {
      const body = format.decode(await req.text()) as RPCRequest;
      const id = body.id ?? null;

      // Lifecycle: initialize handshake (protocolVersion negotiation + capabilities + serverInfo).
      if (body.method === 'initialize') {
        const params = (body.params ?? {}) as { protocolVersion?: string };
        const version = SUPPORTED_VERSIONS.includes(params.protocolVersion ?? '')
          ? params.protocolVersion!
          : PROTOCOL_VERSION;
        return rpcResult(format, id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts?.info?.title ?? 'chord-mcp', version: opts?.info?.version ?? '1.0.0' },
        });
      }
      if (body.method === 'notifications/initialized') {
        return { status: 204, headers: {}, body: null }; // notification — no response
      }
      if (body.method === 'ping') {
        return rpcResult(format, id, {});
      }

      if (body.method === 'tools/list') {
        return rpcResult(format, id, mcpTools(core, { jsonSchema: toJson }));
      }

      if (body.method === 'tools/call') {
        const { name, arguments: args } = (body.params ?? {}) as { name: string; arguments?: unknown };
        const endpoint = core.endpoints().find((e) => `${e.service}.${e.method}` === name);
        const params = endpoint?.contract ? packToolArgs(endpoint.contract, args, toJson) : args;
        const r = await core.call(name, params ?? {}, { ctx });
        const content = [{ type: 'text', text: r.ok ? JSON.stringify(r.value) : r.error.message }];
        return rpcResult(format, id, { content, isError: !r.ok });
      }

      // Other JSON-RPC methods (initialize, ping, …) — same envelope as jsonrpc.
      const result = await core.call(body.method, body.params, { ctx });
      if (id == null) return { status: 204, headers: {}, body: null };
      return { status: 200, headers: headersOf(format), body: format.encode(toWire(result, id)) };
    },
  };
}