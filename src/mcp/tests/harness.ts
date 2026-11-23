// Harness для официального MCP-рефери (@modelcontextprotocol/conformance).
// Поднимает НАШ endpoint поверх node:http и отдаёт его рефери по URL — чёрный ящик,
// без привязки к API SDK. Мост node:http ↔ fetch Request/Response живёт здесь.
//
// Под тестом сейчас спайк-реализация (design/examples/helpers). После переноса в src
// меняется ОДНА строка импорта ниже — сам harness и сценарии не трогаются.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compose } from '@/index';
import { ZodAdapter } from '@/schemas/zod';
import { mcp } from '../../../design/examples/helpers/mcp';
import { fromSvelteKit } from '../../../design/examples/helpers/http';
import { fixtureServices } from './fixtures';

export interface McpTestServer {
  url: string;
  endpoint: ReturnType<typeof mcp>;
  close(): Promise<void>;
}

/** node:http → fetch Request → наш адаптер → fetch Response → node:http (с потоком SSE). */
export async function startMcpServer(): Promise<McpTestServer> {
  const composer = compose(fixtureServices, { schemas: new ZodAdapter() });
  const endpoint = mcp(composer, {
    info: { name: 'chord-mcp-conformance', version: '2.0.0' },
    instructions: 'chord MCP endpoint under conformance test',
  });
  const POST = fromSvelteKit(endpoint);

  const server: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else if (value !== undefined) headers.set(key, value);
      }

      const port = (server.address() as AddressInfo).port;
      const request = new Request(`http://127.0.0.1:${port}${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });

      const response = await POST({ request, locals: undefined });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));

      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      // Клиент оборвал соединение → отмена запроса (spec: закрытие потока = cancel).
      let aborted = false;
      res.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          void reader.cancel().catch(() => {});
        }
      });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          res.write(value);
        }
      } catch {
        // поток закрыт клиентом — не ошибка сервера
      } finally {
        if (!aborted) res.end();
      }
    })().catch((e) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: e instanceof Error ? e.message : String(e) }));
    });
  });

  // Только localhost: рефери ходит по HTTP, наружу endpoint не выставляем.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    endpoint,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
