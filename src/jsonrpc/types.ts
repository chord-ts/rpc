// JSON-RPC 2.0 wire shapes — owned by the jsonrpc family (mcp shares them as a profile).

/** Wire error shape (JSON-RPC error object §5.1): code/message/data. `status` is an optional
 * transport hint for adapters (e.g. the MCP spike's HTTP mapping) — toError never emits it, so the
 * shipped wire error object carries only the standard members. */
export type ErrorObject = { code: number; message: string; data?: unknown; status?: number };

export type RPCId = string | number | null;

export interface RPCRequest {
  method: string;
  params?: unknown;
  id?: RPCId;
}

/** Spec §5: a response carries EITHER result (success) OR error (failure) — never both, never
 * neither. The union makes the invalid "no result and no error" shape unrepresentable. */
export type RPCResponse = {
  jsonrpc: '2.0';
  id: RPCId;
} & ({ result: unknown; error?: never } | { error: ErrorObject; result?: never });

export type RPCBody = RPCRequest | RPCRequest[];