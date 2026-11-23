// Public facade: v1 (deprecated) + v2 re-exported together — имена не пересекаются
// (Composer/rpc/val vs compose/fn/get), общие имена (Middleware/Format) явно из v2.
// Старые пути сохранены (корень = v1+v2), v2 доступен без суффикса версии.
// v2 layers: types → core → schemas → format → generate → tools → protocol → transport.

export * from './v1';
export * from './types';
export * from './core/types';
export type { Middleware } from './core/types'; // v2 поверх v1 Middleware (явный экспорт перебивает star)
export type { McpMeta, McpAnnotations } from './types'; // единый источник; явный экспорт перебивает duplicate star (types + protocol)
export { fn, stream, compose, paramNames } from './core';
export { defaultSchemas, resolveSchemas, flatToolSchema, flatToolJson, withJsonSchema, packToolArgs, wrapScalar, flatObject, stringSchema } from './schemas';
export { json } from './format';
export type { Format, WireFn, ApplyWire, JsonWire, JsonWireOf, FormatTag } from './format/types';
// Генераторы co-located с протоколами (openapi/openrpc/clef/swagger/redoc/asyncapi — в папках протоколов).
export type { GenOptions, StreamMeta, Spec } from './generate';
export { agentTools } from './tools';
export type { AgentTool } from './tools/types';
// Протоколы — top-level папки (impl + docs + index): jsonrpc/rest/capnweb/events/mcp.
export * from './jsonrpc';
export * from './rest';
export * from './capnweb';
export * from './events';
export * from './mcp';
export { messageToHttp } from './message';
export { ErrorCode } from './jsonrpc'; // v2 поверх v1 ErrorCode (явный экспорт перебивает star)
export { fromSvelteKit, fromExpress, fromWs, fromWsStream, type Socket } from './transport';