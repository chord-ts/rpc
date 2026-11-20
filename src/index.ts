// Public facade: v1 (deprecated) + v2 re-exported together — имена не пересекаются
// (Composer/rpc/val vs compose/fn/get), общие имена (Middleware/Format) явно из v2.
// Старые пути сохранены (корень = v1+v2), v2 доступен без суффикса версии.
// v2 layers: types → core → schemas → format → generate → tools → protocol → transport.

export * from './v1';
export * from './types';
export * from './core/types';
export type { Middleware } from './core/types'; // v2 поверх v1 Middleware (явный экспорт перебивает star)
export { fn, stream, compose, paramNames } from './core';
export { defaultSchemas, flatToolSchema, packToolArgs } from './schemas';
export { json } from './format';
export type { Format, WireFn, ApplyWire, JsonWire, JsonWireOf, FormatTag } from './format/types';
export { openapi, openrpc, mcpTools, asyncapi } from './generate';
export type { GenOptions, StreamMeta } from './generate';
export { agentTools } from './tools';
export type { AgentTool } from './tools/types';
export * from './protocol';
export { ErrorCode } from './protocol'; // v2 поверх v1 ErrorCode (явный экспорт перебивает star)
export { fromSvelteKit, fromExpress, fromWs, fromWsStream, type Socket } from './transport';