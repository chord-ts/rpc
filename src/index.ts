// v2 public surface (facade). Re-exports the shared types and the protocol-agnostic core.
// `toRPC`/`exec` is a thin JSON-RPC envelope over core.call — kept for backward compat;
// in the layered migration exec moves to protocol/jsonrpc and toRPC is renamed compose.

export * from './types';
export { fn, compose, paramNames } from './core';
export { defaultSchemas, flatToolSchema, packToolArgs } from './schemas';
export { json } from './format';
export { openapi, openrpc, mcpTools, asyncapi } from './generate';
export type { GenOptions, StreamMeta } from './generate';
export { agentTools } from './tools';
export * from './protocol';
export { fromSvelteKit, fromExpress } from './transport';

import { compose } from './core';
import {
  type Composer,
  type RPCBody,
  type RPCId,
  type RPCResponse,
  type Result,
  type ServiceMap,
  type ToRPCOptions,
} from './types';

function normalize(body: RPCBody): { id: RPCId; method: string; params: unknown }[] {
  return Array.isArray(body)
    ? body.map((req) => ({ id: req.id ?? null, method: req.method, params: req.params }))
    : [{ id: body.id ?? null, method: body.method, params: body.params }];
}

function toWire(result: Result, id: RPCId): RPCResponse {
  if (result.ok) return { jsonrpc: '2.0', id, result: result.value };
  return { jsonrpc: '2.0', id, error: result.error };
}

/** Legacy JSON-RPC composer: core gasket + exec envelope (normalize → call → toWire). */
export function toRPC<S extends ServiceMap>(services: S, options: ToRPCOptions<S>): Composer<S> {
  const core = compose(services, options);

  async function exec(
    body: RPCBody,
    opts?: { ctx?: unknown }
  ): Promise<RPCResponse | RPCResponse[] | undefined> {
    const ctx = opts?.ctx ?? {};
    const out: RPCResponse[] = [];
    for (const call of normalize(body)) {
      const result = await core.call(call.method, call.params, { ctx });
      if (call.id != null) out.push(toWire(result, call.id));
    }
    return Array.isArray(body) ? out : out[0];
  }

  return { ...core, exec };
}