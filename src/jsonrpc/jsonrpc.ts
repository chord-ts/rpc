// JSON-RPC 2.0: the wire model (error codes, envelope, native error → wire mapping) + binding.
// The envelope lives HERE, not in core. Format codecs the whole envelope. rpc.discover serves
// the generated OpenRPC document. mcp (sibling) is a JSON-RPC profile — it imports this model.
// Public surface of the family: ./index.ts.

import { CoreError, type Core, type CoreErrorKind, type ServiceMap } from '@/core/types';
import type { AnySchema, MessageBinding, MessageProtocol, ServiceTag } from '@/types';
import type { Format, FormatTag, WireFn, JsonWire } from '@/format/types';
import { json } from '@/format';
import type { ErrorObject, RPCBody, RPCId, RPCResponse } from './types';
import { openrpc } from './docs';
import { messageToHttp } from '@/message';

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

/** JSON-RPC protocol over VALUES: self-addressed (method inside the envelope), so the native
 * seam is MessageBinding; the http projection is the built-in messageToHttp bridge. Format lives
 * in the transport adapter; the envelope (normalize/batch/toWire) and rpc.discover stay here.
 * Parse errors (raw decode) belong to the adapter. */
export function jsonrpc<S extends ServiceMap, F extends WireFn = JsonWire>(
  core: Core<S>,
  opts?: { format?: Format<any, F>; jsonSchema?: (s: AnySchema) => unknown; info?: { title: string; version: string; description?: string } },
): MessageProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> } {
  const format = (opts?.format ?? json) as Format<any, F>;
  let discovery: object | undefined; // lazy, generated once
  const message: MessageBinding = {
    async handle(value, ctx): Promise<unknown | null> {
      const body = value as RPCBody;
      if (body == null) {
        return { jsonrpc: '2.0', id: null, error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' } };
      }
      // normalize → core.call per call → toWire; notification (no id) → no response.
      const calls = Array.isArray(body) ? body : [body];
      const baseCtx = (ctx ?? {}) as Record<string, unknown>;
      const out: RPCResponse[] = [];
      for (const c of calls) {
        let v: unknown;
        let error: ErrorObject | undefined;
        try {
          v =
            c.method === 'rpc.discover'
              ? (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }).document)
              : await core.call(c.method, c.params, { ctx: { ...baseCtx } }); // per-call copy: no ctx leak across batch
        } catch (e) {
          error = toError(e);
        }
        if (c.id != null) out.push(toWire(c.id, v, error));
      }
      // JSON-RPC spec: a batch of only notifications gets no response (not an empty array).
      if (Array.isArray(body)) return out.length ? out : null;
      return out[0] ?? null;
    },
  };
  return { message, http: messageToHttp(message), format } as MessageProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> };
}