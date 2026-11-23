// Co-location MCP-генератора: реализация mcpTools в generate-слое (ниже tools/protocol,agentTools
// потребляет её), здесь реэкспорт для доступа рядом с MCP. Сабпат @chord-ts/rpc/mcp.
export { mcpTools } from '@/generate/mcp-tools';