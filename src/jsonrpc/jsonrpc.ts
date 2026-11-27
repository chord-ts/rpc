// JSON-RPC 2.0: the wire model (error codes, envelope, native error → wire mapping) + binding.
// The envelope lives HERE, not in core. Format codecs the whole envelope. rpc.discover serves
// the generated OpenRPC document. mcp (sibling) is a JSON-RPC profile — it imports this model.
// Public surface of the family: ./index.ts.

import { CoreError, type Core, type CoreErrorKind, type ServiceMap } from '@/core/types';
import type { AnySchema, MessageBinding, MessageProtocol, ServiceTag } from '@/types';
import type { Format, FormatTag, WireFn, JsonWire } from '@/format/types';
import { json } from '@/format';
import type { ErrorObject, RPCId, RPCResponse } from './types';
import { openrpc } from './docs';
import { messageToHttp } from '@/message';

// --- JSON-RPC 2.0 error codes + typed protocol error ---
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerError: -32000,
} as const;

/** JSON-RPC protocol error (native throw): custom codes, data, optional transport status.
 * Static factories cover the spec codes (§5.1), including the reserved server-error code,
 * with default messages — users throw named errors without memorizing the numbers;
 * the constructor stays for custom codes. */
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

  static parseError(message = 'Parse error', data?: unknown): RpcError {
    return new RpcError(ErrorCode.ParseError, message, data);
  }
  static invalidRequest(message = 'Invalid request', data?: unknown): RpcError {
    return new RpcError(ErrorCode.InvalidRequest, message, data);
  }
  static methodNotFound(message = 'Method not found', data?: unknown): RpcError {
    return new RpcError(ErrorCode.MethodNotFound, message, data);
  }
  static invalidParams(message = 'Invalid params', data?: unknown): RpcError {
    return new RpcError(ErrorCode.InvalidParams, message, data);
  }
  static internal(message = 'Internal error', data?: unknown): RpcError {
    return new RpcError(ErrorCode.InternalError, message, data);
  }
  static serverError(message = 'Server error', data?: unknown): RpcError {
    return new RpcError(ErrorCode.ServerError, message, data);
  }
}

const CORE_CODES: Record<CoreErrorKind, number> = {
  'not-found': ErrorCode.MethodNotFound,
  'invalid-params': ErrorCode.InvalidParams,
  'invalid-output': ErrorCode.InternalError,
};

/** Native error → wire ErrorObject: RpcError keeps code/data, CoreError maps kind → code,
 * anything else → InternalError with a GENERIC message. Unexpected handler failures must not leak
 * internal detail (connection strings, stacks) to the client; RpcError/CoreError carry intentional,
 * safe messages. The wire error object has only code/message/data — no transport `status` member. */
export function toError(e: unknown): ErrorObject {
  if (e instanceof RpcError) {
    return e.data === undefined ? { code: e.code, message: e.message } : { code: e.code, message: e.message, data: e.data };
  }
  if (e instanceof CoreError) {
    return e.data === undefined
      ? { code: CORE_CODES[e.kind], message: e.message }
      : { code: CORE_CODES[e.kind], message: e.message, data: e.data };
  }
  return { code: ErrorCode.InternalError, message: 'Internal error' };
}

export function toWire(id: RPCId, value: unknown, error?: ErrorObject): RPCResponse {
  // result is a REQUIRED member on success (spec §5); a void handler yields undefined → null.
  return error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result: value === undefined ? null : value };
}

// --- Request-structure validation (JSON-RPC 2.0 §4/§5) ---
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
// id MUST be String, Number, or Null (fractional numbers discouraged but not forbidden).
const isValidId = (v: unknown): v is RPCId => v === null || typeof v === 'string' || typeof v === 'number';
// params: chord's wire contract also accepts a bare scalar (convenience over strict §4.2);
// the shape is validated against the endpoint schema by core, not here.
const invalidRequest = (id: RPCId): RPCResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' },
});

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
  // One Request → response (or null for a notification). Structure is validated before dispatch;
  // every read of the item happens inside try, so a malformed batch (e.g. [null]) can never throw
  // out of handle and crash the process.
  async function handleOne(item: unknown, baseCtx: Rec): Promise<RPCResponse | null> {
    const obj = isRec(item) ? item : undefined;
    const id: RPCId = obj && isValidId(obj.id) ? obj.id : null;
    // Spec §4/§5: an invalid Request object gets -32600 even without an id (spec example:
    // {"jsonrpc":"2.0","method":1}). Only a structurally VALID Request without id is a
    // notification — undefined counts as absent (JSON.stringify drops it); null is a VALID id.
    if (
      !obj ||
      obj.jsonrpc !== '2.0' ||
      typeof obj.method !== 'string' ||
      (obj.id !== undefined && !isValidId(obj.id))
    ) {
      return invalidRequest(id);
    }
    const notification = obj.id === undefined;
    const method = obj.method;
    let v: unknown;
    let error: ErrorObject | undefined;
    try {
      v =
        method === 'rpc.discover'
          ? await core.run({ ...baseCtx }, async () => (discovery ??= openrpc(core, { jsonSchema: opts?.jsonSchema, info: opts?.info }).document))
          : await core.call(method, obj.params, { ctx: { ...baseCtx } }); // per-call copy: no ctx leak across batch
    } catch (e) {
      error = toError(e);
    }
    return notification ? null : toWire(id, v, error);
  }

  const message: MessageBinding = {
    async handle(value, ctx): Promise<unknown | null> {
      const baseCtx = (ctx ?? {}) as Rec;
      const isBatch = Array.isArray(value);
      // Empty batch → a single Invalid Request error object (spec §6), not null.
      if (isBatch && value.length === 0) return invalidRequest(null);
      const items = isBatch ? value : [value];
      const out: RPCResponse[] = [];
      for (const item of items) {
        const res = await handleOne(item, baseCtx);
        if (res) out.push(res);
      }
      // A batch of only notifications gets no response (not an empty array).
      if (isBatch) return out.length ? out : null;
      return out[0] ?? null;
    },
  };
  return { message, http: messageToHttp(message), format } as MessageProtocol & ServiceTag<S> & FormatTag<F> & { format: Format<any, F> };
}