// Public facade: v1 (deprecated, полностью) + НЕОБХОДИМЫЙ v2 — core + jsonrpc + transport.
// Остальной v2 (rest-сахар, генераторы доков, capnweb, events, mcpTools, agentTools, schemas-хелперы)
// — только через гранулярные сабпаты (@chord-ts/rpc/rest, /jsonrpc[docs], /capnweb, /events, /mcp,
// /transport/*, /schemas/zod). Root не kitchen-sink — tree-shaking и точечные импорты.
// Общие имена (Middleware/Format/ErrorCode) — явный v2-экспорт перебивает v1 star.

export * from './v1';
export * from './types';
export * from './core/types';
export type { Middleware } from './core/types'; // v2 поверх v1 Middleware
export { fn, stream, compose, paramNames } from './core';
// jsonrpc-биндинг + wire-модель (без docs-генераторов openrpc/clef — они в сабпате /jsonrpc).
export { jsonrpc, ErrorCode, RpcError } from './jsonrpc';
export type { ErrorObject, RPCId, RPCRequest, RPCResponse, RPCBody } from './jsonrpc';
// ZodAdapter — вендорный адаптер схем для compose (zod — optional peer). format — default json, в root не нужен.
export { ZodAdapter } from './schemas/zod';
export { fromSvelteKit, fromExpress, fromWs, fromWsStream, type Socket } from './transport';