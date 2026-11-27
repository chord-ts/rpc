// Client layer contracts: protocol-specific constructors, the inverse composition of the server.
//   server: const api = jsonrpc(composer, { format }); fromSvelteKit(api, event)
//   client: jsonrpc<typeof api>({ endpoint, format })  /  ({ socket, format })
// The generic argument is the SERVER binding type (protocol + services + format). The constructor
// derives services and format from it, guards the protocol (B extends projection) and the format
// (init.format must match the endpoint format), and wire-transforms return types by the endpoint format.
// Transport is chosen by the init shape: endpoint → fetch (http), socket → ws (message).

import type { ServiceMap, MethodKeys } from '../core/types';
import type { WireFn, ApplyWire, Format, FormatTag } from '../format/types';
import type { TransportRequest, TransportResponse, ServiceTag, MessageProtocol, HttpProtocol } from '../types';
import type { Socket } from '../transport';

// --- Client seam (inverse of Binding): request value ↔ response value ---
export interface HttpClientBinding {
  // url: jsonrpc — empty (transport sends to endpoint); rest — path+query (transport resolves from endpoint).
  build(method: string, input: unknown): TransportRequest;
  parse(res: TransportResponse): unknown; // response value → result | throw
}
export interface MessageClientBinding {
  build(method: string, input: unknown): unknown;
  parse(reply: unknown): unknown;
}
/** JSON-RPC client profile projection (mirrors server MessageProtocol): http + message. */
export interface JsonRpcProfile {
  http: HttpClientBinding;
  message: MessageClientBinding;
}
export type CallFn = (method: string, input: unknown) => Promise<unknown>;

// --- Init: transport chosen by shape (endpoint → fetch, socket → ws); format guarded vs endpoint ---
export interface FetchClientInit<F extends WireFn> {
  endpoint: string;
  format?: Format<any, F>;
  headers?: Record<string, string>; // static per-connection headers (auth)
  fetch?: typeof fetch; // override: SvelteKit load, tests, loopback
}
export interface WsClientInit<F extends WireFn> {
  socket: Socket;
  format?: Format<any, F>;
  /** Per-call timeout in ms (off by default): a never-answered call rejects instead of hanging. */
  timeout?: number;
}
export type ClientInit<F extends WireFn> = FetchClientInit<F> | WsClientInit<F>;

// --- Extract services and format from the server binding type ---
export type BindingServices<B> = B extends ServiceTag<infer S> ? S : never;
export type BindingFormat<B> = B extends FormatTag<infer F> ? F : never;
/** Constraints for the constructors: the binding must match the protocol projection. */
export type RpcBinding = MessageProtocol & ServiceTag<any> & FormatTag<any>;
export type RestBinding = HttpProtocol & ServiceTag<any> & FormatTag<any>;

// --- Wire-aware client projection: return types transformed by the endpoint format ---
type WireMethod<M, F extends WireFn> = M extends (...args: infer A) => infer R
  ? (...args: A) => Promise<ApplyWire<F, Awaited<R>>>
  : never;
export type WireClient<S extends ServiceMap, F extends WireFn> = {
  [K in keyof S]: { [M in MethodKeys<InstanceType<S[K]>>]: WireMethod<InstanceType<S[K]>[M], F> };
};

// --- REST manifest = OpenAPI document (the artifact the server serves at /openapi.json) ---
export interface OpenApiOperation {
  operationId?: string;
  parameters?: { name: string; in: string }[];
  requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown>; $ref?: string } }> };
}
export interface OpenApiDoc {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
}