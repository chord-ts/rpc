// MCP Streamable HTTP-транспорт (ПРЕДЛАГАЕМАЯ механика, дизайн-спайк, 2025-06-18).
// Закрывает пробел: mcp-биндинг — только JSON-RPC-семантика методов; реальный транспорт требует
// server→client канал (SSE) + сессии. Пользователь вешает обработчик на GET (SSE-подписка),
// POST (сообщения) и DELETE (завершение сессии) — не только POST.
//
// Поверх message-биндинга (mcpMessage: value → value | null). POST → json-ответ (или 202 для
// notification); GET → SSE-поток сессии (server-push); DELETE → close. Mcp-Session-Id выдаётся
// на initialize. SSE-фреймы текстовые (MCP фиксирует json): `data: {json}\n\n`.
//
// Это схождение stream-глагола (server-push) + SSE-адаптера + session-роутера. Generic унарный
// fromSvelteKit сюда не годится (один Response, не поток) — нужен session-aware SSE-транспорт.

import { json, type Format } from '../../../src';
import type { MessageBinding } from './message';

const encoder = new TextEncoder();

// --- сессия: очередь server→client сообщений + async-ожидание ---

class McpSession {
  private queue: unknown[] = [];
  private notify?: () => void;
  closed = false;
  constructor(public id: string) {}

  send(value: unknown): void {
    this.queue.push(value);
    this.notify?.();
  }
  async next(): Promise<unknown | undefined> {
    while (this.queue.length === 0 && !this.closed) {
      await new Promise<void>((r) => { this.notify = r; });
    }
    return this.queue.shift(); // undefined когда закрыта и пуста
  }
  close(): void {
    this.closed = true;
    this.notify?.();
  }
}

// --- транспорт: GET (SSE) / POST (сообщения) / DELETE (сессия) ---

export function mcpStreamableHttp(mb: MessageBinding, opts: { format?: Format<any> } = {}) {
  const format = opts.format ?? json;
  const sessions = new Map<string, McpSession>();
  let counter = 0;

  async function handle(event: { request: Request }): Promise<Response> {
    const req = event.request;
    const sessionId = req.headers.get('mcp-session-id') ?? undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (req.method === 'DELETE') {
      session?.close();
      if (sessionId) sessions.delete(sessionId);
      return new Response(null, { status: 204 });
    }

    if (req.method === 'GET') {
      // SSE-подписка: server→client поток сессии. Без валидной сессии — 404.
      if (!session) return new Response('Unknown session', { status: 404 });
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const msg = await session.next();
          if (msg === undefined) { controller.close(); return; }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'mcp-session-id': session.id },
      });
    }

    // POST: клиентское сообщение (initialize / request / notification).
    const value = format.decode(await req.text());
    const isInitialize = (value as { method?: string })?.method === 'initialize';
    let sess = session;
    if (isInitialize) {
      sess = new McpSession(`sess-${++counter}`);
      sessions.set(sess.id, sess);
    }
    const reply = await mb.handle(value);
    const headers: Record<string, string> = { 'content-type': format.contentType };
    if (sess) headers['mcp-session-id'] = sess.id;
    if (reply == null) return new Response(null, { status: 202, headers }); // notification → 202
    return new Response(format.encode(reply), { status: 200, headers });
  }

  return {
    handle,
    // server-push в сессию (notifications, серверные запросы sampling/roots) — для демо и роутера.
    push(sessionId: string, value: unknown): void {
      sessions.get(sessionId)?.send(value);
    },
  };
}