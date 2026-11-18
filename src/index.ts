// v2 public surface (facade): re-exports the layered modules.
// types → core → schemas → format → generate → tools → protocol → transport.
// The JSON-RPC envelope lives in the jsonrpc binding (not here); core is protocol-agnostic.

export * from './types';
export * from './core/types';
export { fn, stream, compose, paramNames } from './core';
export { defaultSchemas, flatToolSchema, packToolArgs } from './schemas';
export { json } from './format';
export type { Format } from './format/types';
export { openapi, openrpc, mcpTools, asyncapi } from './generate';
export type { GenOptions, StreamMeta } from './generate';
export { agentTools } from './tools';
export type { AgentTool } from './tools/types';
export * from './protocol';
export { fromSvelteKit, fromExpress, fromWs, fromWsStream, type Socket } from './transport';