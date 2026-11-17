// JSON-RPC 2.0 wire shapes — owned by the jsonrpc family (mcp shares them as a profile).

/** Wire error shape (JSON-RPC error object); produced by toError. */
export type ErrorObject = { code: number; message: string; data?: unknown; status?: number };

export type RPCId = string | number | null;

export interface RPCRequest {
  method: string;
  params?: unknown;
  id?: RPCId;
}

export interface RPCResponse {
  jsonrpc: '2.0';
  id: RPCId;
  result?: unknown;
  error?: ErrorObject;
}

export type RPCBody = RPCRequest | RPCRequest[];