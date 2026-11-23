// Public surface of the JSON-RPC family: the jsonrpc binding + wire model (ErrorCode/RpcError)
// and the mcp binding (a JSON-RPC profile, not a peer). Internal helpers (toError/toWire/
// rpcResult) stay inside the family — mcp imports them from ./jsonrpc directly.

export { jsonrpc, ErrorCode, RpcError } from './jsonrpc';
export { openrpc, clef } from './docs';
export type { ErrorObject, RPCId, RPCRequest, RPCResponse, RPCBody } from './types';