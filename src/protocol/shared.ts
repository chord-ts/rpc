// Shared protocol helpers: JSON-RPC envelope wiring + content-type headers.
// Imports only types — no knowledge of specific bindings.

import type { Format, Result, RPCId, RPCResponse, TransportResponse } from '../types';

export const headersOf = (format: Format) => ({ 'content-type': format.contentType });

export function toWire(result: Result, id: RPCId): RPCResponse {
  return result.ok
    ? { jsonrpc: '2.0', id, result: result.value }
    : { jsonrpc: '2.0', id, error: result.error };
}

export function rpcResult(format: Format, id: RPCId, result: unknown): TransportResponse {
  return { status: 200, headers: headersOf(format), body: format.encode({ jsonrpc: '2.0', id, result }) };
}