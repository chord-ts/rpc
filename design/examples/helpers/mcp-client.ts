// ДЕМО-КЛИЕНТ MCP 2026-07-28 — НЕ часть публичного API chord и не клиентский рантайм пакета.
// Это стенд вместо настоящего MCP-клиента: собирает конформные запросы (заголовки + _meta)
// и разбирает SSE-кадры. Всё, что здесь написано, пользователь библиотеки НЕ пишет — на той
// стороне это делает MCP-клиент (Claude Desktop, инспектор, свой агент).
//
// Зачем отдельно: чтобы пример 06 читался как код пользователя, а не как смесь серверного
// хендлера и клиентской машины. Клиентский рантайм chord — отдельный незакрытый слой (PROGRESS).

import { MCP_VERSION } from './mcp';

export interface DemoRequestOptions {
  /** null → notification (без id). */
  id?: number | null;
  /** Подмена/добавление заголовков — для негативных проверок (mismatch, origin, версия). */
  headers?: Record<string, string>;
  /** Подмена _meta (например, другая версия). */
  meta?: Record<string, unknown>;
  /** Вообще без _meta — проверка stateless-требования. */
  noMeta?: boolean;
  /** Своя версия протокола (заголовок и _meta синхронно). */
  version?: string;
}

const CLIENT_INFO = { name: 'demo-client', version: '1.0.0' };

export function mcpDemoClient(
  handle: (event: { request: Request; locals?: unknown }) => Promise<Response>,
  opts: { version?: string } = {},
) {
  const version = opts.version ?? MCP_VERSION;

  const meta = (over?: Record<string, unknown>) => ({
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {},
    ...over,
  });

  function raw(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return handle({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
      }),
    });
  }

  /** Конформный POST: клиент обязан зеркалировать method/name/версию в заголовки. */
  function post(method: string, params: Record<string, unknown> = {}, o: DemoRequestOptions = {}): Promise<Response> {
    const id = o.id === undefined ? 1 : o.id;
    const v = o.version ?? version;
    const name = params.name ?? params.uri;
    return raw(
      {
        jsonrpc: '2.0',
        ...(id === null ? {} : { id }),
        method,
        params: o.noMeta ? params : { ...params, _meta: meta({ ...o.meta, 'io.modelcontextprotocol/protocolVersion': v }) },
      },
      {
        'mcp-protocol-version': v,
        'mcp-method': method,
        ...(name !== undefined ? { 'mcp-name': String(name) } : {}),
        ...o.headers,
      },
    );
  }

  const json = async (method: string, params?: Record<string, unknown>, o?: DemoRequestOptions) =>
    (await post(method, params, o)).json();

  /** SSE-кадры → значения. Комментарии keep-alive (`:`) — не события. Выход из for await
   * (break/return) закрывает поток ответа: по спеке это и есть отмена запроса. */
  async function* frames(res: Response): AsyncGenerator<any, void, undefined> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('\n');
          if (data) yield JSON.parse(data);
        }
      }
    } finally {
      await reader.cancel();
    }
  }

  /** Собрать все кадры потока (для проверок, где поток конечен). */
  const all = async (res: Response) => {
    const out: any[] = [];
    for await (const msg of frames(res)) out.push(msg);
    return out;
  };

  const method = (m: string, headers: Record<string, string> = {}) =>
    handle({ request: new Request('http://localhost/mcp', { method: m, headers }) });

  return { post, json, raw, frames, all, get: (h?: Record<string, string>) => method('GET', h), del: () => method('DELETE') };
}
