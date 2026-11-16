// JSON-RPC 2.0 binding: the envelope (normalize/toWire/batch) lives HERE, not in core.
// Format codecs the whole envelope. rpc.discover serves the generated OpenRPC document.

import { ErrorCode, type AnySchema, type Binding, type Core, type Format, type Result, type RPCBody, type RPCResponse } from '../types';
import { json as jsonFormat } from '../format';
import { openrpc } from '../generate';
import { headersOf, toWire } from './shared';

export function jsonrpc(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string; description?: string } },
): Binding {
  const format = opts?.format ?? jsonFormat;
  let discovery: object | undefined; // lazy, generated once
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
      // normalize → core.call per call → toWire; notification (no id) → no response.
      const calls = Array.isArray(body) ? body : [body];
      const baseCtx = (ctx ?? {}) as Record<string, unknown>;
      const out: RPCResponse[] = [];
      for (const c of calls) {
        const result: Result =
          c.method === 'rpc.discover'
            ? { ok: true, value: (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info })) }
            : await core.call(c.method, c.params, { ctx: { ...baseCtx } }); // per-call copy: no ctx leak across batch
        if (c.id != null) out.push(toWire(result, c.id));
      }
      const wire = Array.isArray(body) ? out : out[0];
      if (wire === undefined) return { status: 204, headers: {}, body: null };
      return { status: 200, headers: headersOf(format), body: format.encode(wire) };
    },
  };
}