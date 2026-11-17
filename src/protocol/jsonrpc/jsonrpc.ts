// JSON-RPC 2.0: the wire model (error codes, envelope, native error → wire mapping) + binding.
// The envelope lives HERE, not in core. Format codecs the whole envelope. rpc.discover serves
// the generated OpenRPC document. mcp (sibling) is a JSON-RPC profile — it imports this model.
// Public surface of the family: ./index.ts.

import { CoreError, type Core, type CoreErrorKind } from '../../core/types';
import type { Format } from '../../format/types';
import type { AnySchema, Binding, TransportResponse } from '../../types';
import type { ErrorObject, RPCBody, RPCId, RPCResponse } from './types';
import { json as jsonFormat } from '../../format';
import { openrpc } from '../../generate';

// --- JSON-RPC 2.0 error codes + typed protocol error ---
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

/** JSON-RPC protocol error (native throw): custom codes, data, optional transport status. */
export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
    public status?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

const CORE_CODES: Record<CoreErrorKind, number> = {
  'not-found': ErrorCode.MethodNotFound,
  'invalid-params': ErrorCode.InvalidParams,
  'invalid-output': ErrorCode.InternalError,
};

/** Native error → wire ErrorObject: RpcError keeps code/data/status, CoreError maps kind → code,
 * anything else → InternalError. */
export function toError(e: unknown): ErrorObject {
  if (e instanceof RpcError) {
    return { code: e.code, message: e.message, data: e.data, status: e.status };
  }
  if (e instanceof CoreError) {
    return { code: CORE_CODES[e.kind], message: e.message, data: e.data };
  }
  return { code: ErrorCode.InternalError, message: e instanceof Error ? e.message : String(e) };
}

export function toWire(id: RPCId, value: unknown, error?: ErrorObject): RPCResponse {
  return error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result: value };
}

export function rpcResult(format: Format, id: RPCId, result: unknown): TransportResponse {
  return { status: 200, headers: { 'content-type': format.contentType }, body: format.encode({ jsonrpc: '2.0', id, result }) };
}

export function jsonrpc(
  core: Core<any>,
  opts?: { format?: Format; jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string; description?: string } },
): Binding {
  const format = opts?.format ?? jsonFormat;
  let discovery: object | undefined; // lazy, generated once
  return {
    async handle(req, ctx): Promise<TransportResponse> {
      let body: RPCBody;
      try {
        body = format.decode(await req.text()) as RPCBody;
      } catch {
        const parseError: RPCResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: ErrorCode.ParseError, message: 'Parse error' },
        };
        return { status: 200, headers: { 'content-type': format.contentType }, body: format.encode(parseError) };
      }
      // normalize → core.call per call → toWire; notification (no id) → no response.
      const calls = Array.isArray(body) ? body : [body];
      const baseCtx = (ctx ?? {}) as Record<string, unknown>;
      const out: RPCResponse[] = [];
      for (const c of calls) {
        let value: unknown;
        let error: ErrorObject | undefined;
        try {
          value =
            c.method === 'rpc.discover'
              ? (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }))
              : await core.call(c.method, c.params, { ctx: { ...baseCtx } }); // per-call copy: no ctx leak across batch
        } catch (e) {
          error = toError(e);
        }
        if (c.id != null) out.push(toWire(c.id, value, error));
      }
      const wire = Array.isArray(body) ? out : out[0];
      if (wire === undefined) return { status: 204, headers: {}, body: null };
      return { status: 200, headers: { 'content-type': format.contentType }, body: format.encode(wire) };
    },
  };
}