// Регрессии по ревью: B7 (вызов без аргументов), B8 (WS-корреляция), H7/B3 (WS-транспорт).

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  compose, fn, jsonrpc as bindJsonrpc, fromSvelteKit, RpcError,
} from '../index';
import { fromWs as serveWs, fromWsStream as serveWsStream } from '@/transport';
import type { StreamProtocol } from '../types';
import { get, post, rest as bindRest, openapi } from '@/rest';
import { jsonrpc, rest } from './index';
import type { OpenApiDoc } from './types';

class Math {
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add = Math.$add(async (x) => x.a + x.b);
  static $ping = fn({ in: z.void(), out: z.string() });
  ping = Math.$ping(async () => 'pong');
  static $boom = fn({ in: z.void(), out: z.string() });
  boom = Math.$boom(async () => {
    throw new Error('internal-detail');
  });
}

const api = bindJsonrpc(compose({ Math }));

function makeSocket() {
  let handler: ((data: string | Uint8Array) => void | Promise<void>) | undefined;
  let closeHandler: (() => void) | undefined;
  return {
    sent: [] as (string | Uint8Array)[],
    send(data: string | Uint8Array) {
      this.sent.push(data);
    },
    onMessage(h: (data: string | Uint8Array) => void | Promise<void>) {
      handler = h;
    },
    onClose(h: () => void) {
      closeHandler = h;
    },
    emit(data: string | Uint8Array) {
      return handler?.(data);
    },
    close() {
      closeHandler?.();
    },
  };
}
function pair() {
  const c = makeSocket();
  const s = makeSocket();
  c.send = (d) => {
    void s.emit(d);
  };
  s.send = (d) => {
    void c.emit(d);
  };
  return { c, s };
}

describe('B7: zero-argument call', () => {
  const POST = (e: { request: Request }) => fromSvelteKit(api, e);
  const rpc = jsonrpc<typeof api>({
    endpoint: 'http://localhost/rpc',
    fetch: (input, init) => POST({ request: new Request(input, init) }),
  });
  it('rpc.Math.ping() omits params and reaches a void handler', async () => {
    expect(await rpc.Math.ping()).toBe('pong');
  });
});

describe('B8: WS client correlation', () => {
  it('parallel calls correlate by id (no lost/hung promises)', async () => {
    const { c, s } = pair();
    serveWs(api, s);
    const rpc = jsonrpc<typeof api>({ socket: c });
    const p1 = rpc.Math.add({ a: 1, b: 1 });
    const p2 = rpc.Math.add({ a: 2, b: 2 });
    expect(await p1).toBe(2);
    expect(await p2).toBe(4);
  });

  it('error reply rejects the matching promise with RpcError', async () => {
    const { c, s } = pair();
    serveWs(api, s);
    const rpc = jsonrpc<typeof api>({ socket: c });
    await expect(rpc.Math.boom()).rejects.toBeInstanceOf(RpcError);
  });

  it('socket close rejects pending calls (no eternal hang)', async () => {
    const c = makeSocket(); // no server wired → no reply
    const rpc = jsonrpc<typeof api>({ socket: c });
    const p = rpc.Math.add({ a: 1, b: 1 });
    c.close();
    await expect(p).rejects.toThrow('Socket closed');
  });
});

describe('H7/B3: WS transport robustness', () => {
  it('fromWs: malformed frame → parse-error reply, process not crashed', async () => {
    const s = makeSocket();
    const c = makeSocket();
    s.send = (d) => {
      c.sent.push(d);
    };
    serveWs(api, s);
    await s.emit('not json');
    const frame = JSON.parse(c.sent[0] as string);
    expect(frame.error.code).toBe(-32700);
  });

  it('fromWsStream: unexpected stream error → generic error frame (no leak)', async () => {
    const binding: StreamProtocol = {
      stream: {
        handle: () =>
          (async function* () {
            throw new Error('secret-db-host');
          })(),
      },
    };
    const s = makeSocket();
    const c = makeSocket();
    s.send = (d) => {
      c.sent.push(d);
    };
    serveWsStream(binding, s);
    await s.emit(JSON.stringify({ method: 'x' }));
    const frame = JSON.parse(c.sent[0] as string);
    expect(frame.error).toBe('Internal error');
    expect(JSON.stringify(frame)).not.toContain('secret-db-host');
  });

  it('fromWsStream: onClose runs generator cleanup', async () => {
    let cleaned = false;
    let resume!: () => void;
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    const binding: StreamProtocol = {
      stream: {
        handle: () =>
          (async function* () {
            try {
              yield 1;
              await gate; // slow producer: parked here when close arrives
              yield 2;
            } finally {
              cleaned = true;
            }
          })(),
      },
    };
    const s = makeSocket();
    s.send = () => {};
    serveWsStream(binding, s);
    void s.emit(JSON.stringify({}));
    await new Promise((r) => setTimeout(r, 10)); // yield 1 consumed, now awaiting gate
    s.close(); // onClose → it.return() queued
    resume(); // gate resolves → generator reaches yield, pending return() runs finally
    await new Promise((r) => setTimeout(r, 10));
    expect(cleaned).toBe(true);
  });
});

// --- Второй раунд ревью: HTTP-статус, REST URL/query, WS id-коллизии и timeout ---

describe('review2: jsonrpc client honors HTTP status', () => {
  it('401 without an envelope rejects (never resolves as undefined)', async () => {
    const rpc = jsonrpc<typeof api>({
      endpoint: 'http://localhost/rpc',
      fetch: async () => new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 }),
    });
    await expect(rpc.Math.add({ a: 1, b: 1 })).rejects.toMatchObject({ status: 401, message: 'unauthorized' });
  });

  it('adapter parse error arrives as the -32700 envelope (not a bare {detail})', async () => {
    const res = await fromSvelteKit(api, {
      request: { method: 'POST', url: 'http://localhost/rpc', text: async () => 'not json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });
});

class Tags {
  static $list = get('/tags', { query: z.object({ tag: z.union([z.string(), z.array(z.string())]).optional() }) });
  list = Tags.$list(async ({ tag }) => ({ tag: tag ?? null }));
}

type NodeT = { value: number; children: NodeT[] };
const Node: z.ZodType<NodeT> = z.lazy(() => z.object({ value: z.number(), children: z.array(Node) }));

class Tree {
  static $save = post('/tree', { body: Node });
  save = Tree.$save(async (input) => input);
}

describe('review2: rest client URL building', () => {
  const restApi = bindRest(compose({ Tags, Tree }));
  const doc = openapi(compose({ Tags, Tree })).document as OpenApiDoc;
  const loopback = (POST: (e: { request: Request }) => Promise<Response>) => (input: RequestInfo | URL, init?: RequestInit) =>
    POST({ request: new Request(input, init) });

  it('endpoint prefix is preserved (path joins UNDER it)', async () => {
    const seen: string[] = [];
    const rpc = rest<typeof restApi>({
      endpoint: 'http://localhost/api/v1',
      doc,
      fetch: async (input) => {
        seen.push(new URL(String(input)).pathname);
        return new Response(JSON.stringify({ tag: null }), { status: 200 });
      },
    });
    await rpc.Tags.list({ tag: 'x' });
    expect(seen[0]).toBe('/api/v1/tags');
  });

  it('relative endpoint works (no Invalid URL)', async () => {
    const seen: (string | URL | RequestInfo)[] = [];
    const rpc = rest<typeof restApi>({
      endpoint: '/api',
      doc,
      fetch: async (input) => {
        seen.push(input);
        return new Response(JSON.stringify({ tag: null }), { status: 200 });
      },
    });
    await rpc.Tags.list({});
    expect(String(seen[0])).toBe('/api/tags');
  });

  it('array query goes as repeated keys, server parses it back into an array', async () => {
    const REST = (e: { request: Request }) => fromSvelteKit(restApi, e);
    const rpc = rest<typeof restApi>({ endpoint: 'http://localhost', doc, fetch: loopback(REST) });
    expect(await rpc.Tags.list({ tag: ['a', 'b'] })).toEqual({ tag: ['a', 'b'] });
  });

  it('recursive body schema ($ref root) is dereferenced from components', async () => {
    const REST = (e: { request: Request }) => fromSvelteKit(restApi, e);
    const rpc = rest<typeof restApi>({ endpoint: 'http://localhost', doc, fetch: loopback(REST) });
    expect(await rpc.Tree.save({ value: 1, children: [] })).toEqual({ value: 1, children: [] });
  });
});

// --- Паритет с v1 defaultTransport: сетевой сбой, редирект, HTML-страницы ошибок, битый JSON ---

describe('v1-parity: HTTP transport errors', () => {
  const call = (rpc: ReturnType<typeof jsonrpc<typeof api>>) => rpc.Math.add({ a: 1, b: 1 });

  it('network failure → RpcError.serverError with the fetch message and cause', async () => {
    const cause = new Error('ECONNREFUSED');
    const rpc = jsonrpc<typeof api>({
      endpoint: 'http://localhost/rpc',
      fetch: async () => {
        throw cause;
      },
    });
    await expect(call(rpc)).rejects.toMatchObject({ code: -32000, message: 'ECONNREFUSED', data: cause });
  });

  it('redirect without location (SSR) → throw with the target in data', async () => {
    const rpc = jsonrpc<typeof api>({
      endpoint: 'http://localhost/rpc',
      fetch: async () => ({ redirected: true, url: 'http://localhost/login', status: 200 }) as unknown as Response,
    });
    await expect(call(rpc)).rejects.toMatchObject({
      message: 'Redirected to http://localhost/login',
      data: { status: 200, location: 'http://localhost/login', redirected: true },
    });
  });

  it('redirect in the browser → location.assign to the final URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    try {
      const rpc = jsonrpc<typeof api>({
        endpoint: 'http://localhost/rpc',
        fetch: async () => ({ redirected: true, url: 'http://localhost/login', status: 200 }) as unknown as Response,
      });
      await expect(call(rpc)).rejects.toThrow('Redirected');
      expect(assign).toHaveBeenCalledWith('http://localhost/login');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('HTTP 500 HTML page → raw body in data, logged preview without tags (no decode crash)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const html = '<html><body><h1>500</h1><p>db-host-1 failed</p></body></html>';
      const rpc = jsonrpc<typeof api>({
        endpoint: 'http://localhost/rpc',
        fetch: async () => new Response(html, { status: 500, statusText: 'Internal Server Error', headers: { 'content-type': 'text/html' } }),
      });
      await expect(call(rpc)).rejects.toMatchObject({ status: 500, message: 'HTTP 500', data: { body: html } });
      const logged = String(spy.mock.calls[0]?.[0]);
      expect(logged).toContain('HTTP 500 Internal Server Error');
      expect(logged).toContain('db-host-1 failed');
      expect(logged).not.toContain('<h1>');
    } finally {
      spy.mockRestore();
    }
  });

  it('2xx with a non-format body → RpcError.parseError (-32700)', async () => {
    const rpc = jsonrpc<typeof api>({
      endpoint: 'http://localhost/rpc',
      fetch: async () => new Response('not json', { status: 200 }),
    });
    await expect(call(rpc)).rejects.toMatchObject({ code: -32700, message: 'Invalid response' });
  });

  it('REST: HTML error page keeps the raw body on the thrown Error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const restApi = bindRest(compose({ Tags }));
      const doc = openapi(compose({ Tags })).document as OpenApiDoc;
      const html = '<html><body>gateway timeout</body></html>';
      const rpc = rest<typeof restApi>({
        endpoint: 'http://localhost',
        doc,
        fetch: async () => new Response(html, { status: 504, statusText: 'Gateway Timeout', headers: { 'content-type': 'text/html' } }),
      });
      await expect(rpc.Tags.list({})).rejects.toMatchObject({ status: 504, message: 'HTTP 504', body: html });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('review2: WS client ids and timeout', () => {
  it('two clients on one socket do not claim each other replies', async () => {
    // реальный сокет доставляет фрейм ВСЕМ слушателям — эмулируем broadcast-доставку
    const handlers: ((data: string | Uint8Array) => void | Promise<void>)[] = [];
    const s = makeSocket();
    const c = {
      send: (d: string | Uint8Array) => {
        void s.emit(d);
      },
      onMessage: (h: (data: string | Uint8Array) => void | Promise<void>) => {
        handlers.push(h);
      },
    };
    s.send = (d) => {
      for (const h of handlers) void h(d);
    };
    serveWs(api, s);
    const rpc1 = jsonrpc<typeof api>({ socket: c });
    const rpc2 = jsonrpc<typeof api>({ socket: c });
    const [r1, r2] = await Promise.all([rpc1.Math.add({ a: 1, b: 1 }), rpc2.Math.add({ a: 2, b: 2 })]);
    expect(r1).toBe(2);
    expect(r2).toBe(4);
  });

  it('optional timeout rejects a never-answered call', async () => {
    const c = makeSocket(); // no server wired → no reply
    const rpc = jsonrpc<typeof api>({ socket: c, timeout: 10 });
    await expect(rpc.Math.add({ a: 1, b: 1 })).rejects.toThrow('timed out');
  });
});
