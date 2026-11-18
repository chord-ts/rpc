import { expect, test } from 'vitest';
import { z } from 'zod';
import { fn, get, stream, compose, rest, jsonrpc, events, fromSvelteKit, fromExpress, fromWs, fromWsStream } from '../index';
import { ZodAdapter } from '../schemas/zod';

class Catalog {
  constructor() {}
  static $getItem = get('/items/{item_id}', {
    resp: { 200: z.object({ id: z.string() }) },
  });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id }) => ({ id: item_id });
}

class Math {
  constructor() {}
  static $count = fn({ in: z.number(), out: z.number() });
  count: typeof Math.$count.fn = async (n) => n + 1;
}

const composer = compose({ Catalog, Math }, { inject: {}, schemas: new ZodAdapter() });

test('fromSvelteKit: binding → fetch Response', async () => {
  const res = await fromSvelteKit(rest(composer), {
    request: { method: 'GET', url: 'http://localhost/items/42', text: async () => '' },
    locals: {},
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(await res.json()).toEqual({ id: '42' });
});

test('fromExpress: structural req/res → JSON-RPC response', async () => {
  const captured: { status?: number; body?: string | null; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return res; },
    set(field: string, value: string) { captured.headers[field] = value; return res; },
    send(body?: string | null) { captured.body = body; return res; },
  };
  await fromExpress(
    jsonrpc(composer),
    { method: 'POST', url: '/rpc', body: { jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 } },
    res,
  );
  expect(captured.status).toBe(200);
  expect(JSON.parse(captured.body!)).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });
});

test('fromWs: message-проекция → фреймы, notification → без фрейма', async () => {
  const sent: (string | Uint8Array)[] = [];
  type Handler = (data: string | Uint8Array) => void | Promise<void>;
  let handler: Handler | undefined;
  const socket = {
    send(data: string | Uint8Array) { sent.push(data); },
    onMessage(h: Handler) { handler = h; },
  };
  fromWs(jsonrpc(composer), socket); // default json
  await handler!(JSON.stringify({ jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 }));
  expect(JSON.parse(sent[0] as string)).toEqual({ jsonrpc: '2.0', id: 1, result: 6 });

  await handler!(JSON.stringify({ jsonrpc: '2.0', method: 'Math.count', params: 5 }));
  expect(sent.length).toBe(1); // notification → null → фрейм не шлётся

  // @ts-expect-error — REST без message-проекции: WS недоступен на этапе типов.
  fromWs(rest(composer), { send: () => {}, onMessage: () => {} });
});

test('fromWsStream: подписка → фреймы, cancel → 0 фреймов, ошибка → error-фрейм', async () => {
  class Ticker {
    static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
    countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
      for (let n = from; n > 0; n--) {
        yield { n };
        await new Promise((r) => setTimeout(r, 1));
      }
    };
  }
  const c = compose({ Ticker });
  type Handler = (data: string | Uint8Array) => void | Promise<void>;

  const sent: (string | Uint8Array)[] = [];
  let handler: Handler | undefined;
  const socket = {
    send(data: string | Uint8Array) { sent.push(data); },
    onMessage(h: Handler) { handler = h; },
  };
  fromWsStream(events(c), socket); // default json
  await handler!(JSON.stringify({ method: 'Ticker.countdown', params: { from: 3 } }));
  expect(sent.map((f) => JSON.parse(f as string))).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);

  // cancel синхронно сразу за подпиской (до первого события) → генератор не стартовал, 0 фреймов.
  const sent2: (string | Uint8Array)[] = [];
  let h2: Handler | undefined;
  const socket2 = {
    send(data: string | Uint8Array) { sent2.push(data); },
    onMessage(h: Handler) { h2 = h; },
  };
  fromWsStream(events(c), socket2);
  const p = h2!(JSON.stringify({ method: 'Ticker.countdown', params: { from: 3 } }));
  await h2!(JSON.stringify({ cancel: true }));
  await p;
  expect(sent2.length).toBe(0);

  // Ошибка стрима — нативный throw → error-фрейм.
  await handler!(JSON.stringify({ method: 'Ticker.countdown', params: { from: 'x' } }));
  expect(JSON.parse(sent[sent.length - 1] as string)).toEqual({ error: 'Validation error' });

  // @ts-expect-error — REST без stream-проекции.
  fromWsStream(rest(composer), { send: () => {}, onMessage: () => {} });
  // @ts-expect-error — events без message-проекции.
  fromWs(events(c), { send: () => {}, onMessage: () => {} });
});