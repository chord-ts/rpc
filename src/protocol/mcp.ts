// MCP binding: JSON-RPC 2.0 profile (tools/list + tools/call) over the registry.
// Format codecs the JSON-RPC envelope (MCP fixes json). tools/list reuses the mcpTools generator;
// tools/call packs args via the shared packToolArgs seam (same as agent tools).
// NOTE: tools-subset — no initialize handshake yet (real MCP clients won't connect; see PROGRESS).

import type { AnySchema, Binding, Core, Format, RPCRequest } from '../types';
import { json as jsonFormat } from '../format';
import { mcpTools } from '../generate';
import { defaultSchemas, packToolArgs } from '../schemas';
import { headersOf, rpcResult, toWire } from './shared';

export interface McpMeta {
  desc?: string;
  title?: string;
}

export function mcp(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown },
): Binding {
  const format = opts?.format ?? jsonFormat;
  const toJson = opts?.jsonSchema ?? core.schemas?.jsonSchema ?? defaultSchemas.jsonSchema;
  return {
    async handle(req, ctx) {
      const body = format.decode(await req.text()) as RPCRequest;
      const id = body.id ?? null;

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