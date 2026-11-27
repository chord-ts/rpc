// Public facade: v1 (deprecated, полностью) + НЕОБХОДИМЫЙ v2 — core + jsonrpc + transport.
// Остальной v2 (rest-сахар, генераторы доков, events, mcpTools, agentTools, schemas-хелперы)
// — только через гранулярные сабпаты (@chord-ts/rpc/rest, /jsonrpc[docs], /events, /mcp, /tools,
// /transport/*, /schemas/zod). capnweb и WS-транспорт (fromWs/fromWsStream) не публикуются
// до закрытия своих долгов; код и тесты остаются в src.
// Root не kitchen-sink — tree-shaking и точечные импорты.
// Общие имена (Middleware/Format/ErrorCode) — явный v2-экспорт перебивает v1 star.

export * from './v1';
export * from './types';
export * from './core/types';
export type { Middleware } from './core/types'; // v2 поверх v1 Middleware
export { fn, stream, compose, paramNames } from './core';
// jsonrpc-биндинг + wire-модель (без docs-генераторов openrpc/clef — они в сабпате /jsonrpc).
export { jsonrpc, ErrorCode, RpcError } from './jsonrpc';
export type { ErrorObject, RPCId, RPCRequest, RPCResponse, RPCBody } from './jsonrpc';
// ZodAdapter — вендорный лист, только сабпат @chord-ts/rpc/schemas/zod (zod — optional peer).
// В корне его нет: корневой импорт не должен тянуть zod, если пользователь не выбрал zod-адаптер.
// WS-адаптеры (fromWs/fromWsStream) исключены из публичного API до стабилизации; тип Socket
// остаётся — он нужен клиентскому socket-режиму (jsonrpc({ socket }) из ./client).
export { fromSvelteKit, fromExpress, type Socket } from './transport';
// v2 Format перебивает v1-тип из star: свои форматы (MIGRATION) пишутся против v2-контракта,
// кодек json — дефолт эндпоинтов, доступен с корня.
export type { Format, WireFn, JsonWire, ApplyWire } from './format/types';
export { json } from './format';