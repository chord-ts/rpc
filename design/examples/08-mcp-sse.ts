// 08 · MCP Streamable HTTP (продвинутый). MCP требует НЕ только POST, но и GET-подписку (SSE
// server→client) + сессии. Пользователь вешает обработчик на GET, POST и DELETE. Переиспользует Math.
// Поверх mcpMessage (message-шов) — транспорт добавляет сессию + SSE-канал.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/08-mcp-sse.ts

import { compose } from '../../src';
import { ZodAdapter } from '../../src/schemas/zod';
import { Math } from './shared';
import { mcpMessage } from './helpers/message';
import { mcpStreamableHttp } from './helpers/mcp-transport';

const composer = compose({ Math }, { inject: {}, schemas: new ZodAdapter() });
const mcpHttp = mcpStreamableHttp(mcpMessage(composer));

// SvelteKit: src/routes/mcp/+server.ts — обработчик на ВСЕ три метода, не только POST.
export const GET = (event: { request: Request }) => mcpHttp.handle(event); // SSE-подписка
export const POST = (event: { request: Request }) => mcpHttp.handle(event); // сообщения
export const DELETE = (event: { request: Request }) => mcpHttp.handle(event); // завершение сессии

const post = (body: unknown, sessionId?: string) =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: sessionId ? { 'mcp-session-id': sessionId } : {},
    body: JSON.stringify(body),
  });

(async () => {
  // initialize → сервер выдаёт Mcp-Session-Id.
  const init = await POST({ request: post({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-06-18' }, id: 1 }) });
  const sessionId = init.headers.get('mcp-session-id')!;
  console.log('08 initialize →', sessionId, (await init.json()).result.protocolVersion);

  // tools/call с session id → json-ответ.
  const call = await POST({ request: post({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'Math.count', arguments: { value: 41 } }, id: 2 }, sessionId) });
  console.log('08 tools/call →', (await call.json()).result.content[0].text); // 42

  // notification → 202 Accepted (без тела).
  const notif = await POST({ request: post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId) });
  console.log('08 notification →', notif.status); // 202

  // GET — SSE-подписка (то, что надо навесить ДОПОЛНИТЕЛЬНО к POST!).
  const sse = await GET({ request: new Request('http://localhost/mcp', { headers: { 'mcp-session-id': sessionId } }) });
  console.log('08 GET SSE →', sse.headers.get('content-type')); // text/event-stream
  const reader = sse.body!.getReader();
  const readPromise = reader.read();
  mcpHttp.push(sessionId, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); // server-push
  const { value } = await readPromise;
  console.log('08 SSE event →', new TextDecoder().decode(value).trim()); // data: {...list_changed}
  await reader.cancel();

  // DELETE — завершение сессии.
  const del = await DELETE({ request: new Request('http://localhost/mcp', { method: 'DELETE', headers: { 'mcp-session-id': sessionId } }) });
  console.log('08 DELETE →', del.status); // 204
})();