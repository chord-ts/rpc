// Generate-слой: общие хелперы (core) + mcpTools (ниже tools/protocol). Протокол-генераторы
// (openrpc/clef, openapi/swagger/redoc, asyncapi) живут рядом со своими протоколами и импортят
// generate/core; здесь их нет (co-location). mcpTools остаётся в generate — общий для agentTools и mcp-handler.

export * from './core';
export * from './mcp-tools';