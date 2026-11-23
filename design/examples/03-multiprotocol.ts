// 03 · Мультипротокол (расширенный). Один compose обслуживается rest + jsonrpc + mcp одновременно;
// агентские тулы in-process (LangChain) из того же реестра. REST и fn — разные классы.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/03-multiprotocol.ts

import { compose, rest, jsonrpc, mcpTools, fromSvelteKit, agentTools } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';
import { Catalog, Math } from './shared';

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });
const restApi = rest(composer); // REST-класс Catalog
const rpc = jsonrpc(composer); // RPC-класс Math (+ rpc.discover)
const mcpApi = mcpTools(composer); // MCP tools-дескрипторы (транспорт MCP 2026-07-28 — пример 13)

const post = (body: unknown) =>
  new Request('http://localhost/rpc', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  const rpcRes = await fromSvelteKit(rpc, { request: post({ jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 }) });
  console.log('03 jsonrpc →', await rpcRes.json()); // result: 6

  const list = await fromSvelteKit(mcpApi, { request: post({}) });
  console.log('03 mcp tools →', (await list.json()).tools.map((t: any) => t.name));

  // Агентские тулы in-process: schema — нативный zod, invoke/func поверх ядра.
  console.log('03 agentTools →', agentTools(composer).map((t) => t.name));
})();