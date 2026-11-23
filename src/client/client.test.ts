import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compose, fn, jsonrpc as bindJsonrpc, fromSvelteKit, fromWs as serveWs, RpcError } from '../index';
import { get, post, rest as bindRest, openapi } from '@/rest';
import type { Format, WireFn } from '../format/types';
import { jsonrpc, rest } from './index';

// Сервисы: RPC (fn) и REST (get/post) — раздельные compose (класс протокол-согласован).
class Math {
  constructor() {}
  static $add = fn({ in: z.object({ a: z.number(), b: z.number() }), out: z.number() });
  add: typeof Math.$add.fn = async (x) => x.a + x.b;
}
class Clock {
  constructor() {}
  static $now = fn({ in: z.void(), out: z.date() });
  now: typeof Clock.$now.fn = async () => new Date('2026-01-01T00:00:00Z');
}
class Lists {
  constructor() {}
  static $sumAll = fn({ in: z.array(z.number()), out: z.number() });
  sumAll: typeof Lists.$sumAll.fn = async (nums) => nums.reduce((a, b) => a + b, 0);
  static $repeat = fn({ in: z.tuple([z.string(), z.number()]), out: z.string() });
  repeat: typeof Lists.$repeat.fn = async (text, times) => text.repeat(times);
  static $upper = fn({ in: z.string(), out: z.string() });
  upper: typeof Lists.$upper.fn = async (s) => s.toUpperCase();
}
class Catalog {
  constructor() {}
  static $getItem = get('/items/{item_id}', { query: z.object({ q: z.string().optional() }), resp: { 200: z.object({ id: z.string(), name: z.string() }) } });
  getItem: typeof Catalog.$getItem.fn = async ({ item_id, q }) => ({ id: item_id, name: `item ${item_id}${q ? ` (${q})` : ''}` });
  static $createItem = post('/items', { body: z.object({ name: z.string() }), resp: { 201: z.object({ id: z.string(), name: z.string() }) }, status: 201 });
  createItem: typeof Catalog.$createItem.fn = async ({ name }) => ({ id: 'new', name });
}

// devalue-подобный кодек: сохраняет Date (маркер $date). Бренд отличает формат от json.
interface DevalueWire extends WireFn {
  readonly __brand: 'devalue';
  readonly __out?: this['__arg'];
}
const devalue: Format<string, DevalueWire> = {
  contentType: 'application/json',
  unit: 'text',
  decode: (raw) => JSON.parse(raw, (_k, v) => (v && typeof v === 'object' && typeof v.$date === 'string' ? new Date(v.$date) : v)),
  encode: (value) => JSON.stringify(value, function (this: Record<string, unknown>, k, v) {
    const raw = this[k];
    return raw instanceof Date ? { $date: raw.toISOString() } : v;
  }),
};

const rpcComposer = compose({ Math, Clock, Lists });
const restComposer = compose({ Catalog });
const loopback = (POST: (e: { request: Request }) => Promise<Response>) => (input: RequestInfo | URL, init?: RequestInit) =>
  POST({ request: new Request(input, init) });

describe('client jsonrpc', () => {
  const api = bindJsonrpc(rpcComposer);
  const POST = (e: { request: Request }) => fromSvelteKit(api, e);
  const rpc = jsonrpc<typeof api>({ endpoint: 'http://localhost/rpc', fetch: loopback(POST) });

  it('call typed input → result', async () => {
    expect(await rpc.Math.add({ a: 2, b: 3 })).toBe(5);
  });

  it('validation error → native RpcError with wire code', async () => {
    await expect(rpc.Math.add({ a: 'x', b: 3 } as any)).rejects.toMatchObject({ code: -32602 });
    await expect(rpc.Math.add({ a: 'x', b: 3 } as any)).rejects.toBeInstanceOf(RpcError);
  });

  it('unknown method → RpcError -32601', async () => {
    await expect((rpc as any).Math.nope()).rejects.toMatchObject({ code: -32601 });
  });
});

describe('client jsonrpc positional wire contract', () => {
  const api = bindJsonrpc(rpcComposer);
  const POST = (e: { request: Request }) => fromSvelteKit(api, e);
  const rpc = jsonrpc<typeof api>({ endpoint: 'http://localhost/rpc', fetch: loopback(POST) });

  it('array-as-value: single array arg wrapped [[…]] → handler receives the array', async () => {
    expect(await rpc.Lists.sumAll([1, 2, 3])).toBe(6);
  });

  it('tuple: several args → positional [a, b]', async () => {
    expect(await rpc.Lists.repeat('ab', 3)).toBe('ababab');
  });

  it('scalar: bare value tolerated by the server', async () => {
    expect(await rpc.Lists.upper('hello')).toBe('HELLO');
  });
});

describe('client jsonrpc format guard + wire types', () => {
  // эндпоинт объявляет devalue; клиент с тем же форматом → Date переживает провод.
  const api = bindJsonrpc(rpcComposer, { format: devalue });
  const POST = (e: { request: Request }) => fromSvelteKit(api, e);
  const rpc = jsonrpc<typeof api>({ endpoint: 'http://localhost/rpc', format: devalue, fetch: loopback(POST) });

  it('matching format preserves Date (wire type Date)', async () => {
    const d = await rpc.Clock.now(undefined);
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('json endpoint → Date becomes string (wire type string)', async () => {
    const apiJson = bindJsonrpc(rpcComposer); // default json
    const POSTjson = (e: { request: Request }) => fromSvelteKit(apiJson, e);
    const rpcJson = jsonrpc<typeof apiJson>({ endpoint: 'http://localhost/rpc', fetch: loopback(POSTjson) });
    const j = await rpcJson.Clock.now(undefined);
    expect(typeof j).toBe('string');
    expect(j).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('client rest', () => {
  const restApi = bindRest(restComposer);
  const REST = (e: { request: Request }) => fromSvelteKit(restApi, e);
  const doc = openapi(restComposer).document as any;
  const rpc = rest<typeof restApi>({ endpoint: 'http://localhost', doc, fetch: loopback(REST) });

  it('GET path+query from flat input', async () => {
    expect(await rpc.Catalog.getItem({ item_id: '42', q: 'foo' })).toEqual({ id: '42', name: 'item 42 (foo)' });
  });

  it('POST body from flat input', async () => {
    expect(await rpc.Catalog.createItem({ name: 'widget' })).toEqual({ id: 'new', name: 'widget' });
  });

  it('validation error → native throw with HTTP status', async () => {
    await expect(rpc.Catalog.createItem({ name: 123 } as any)).rejects.toMatchObject({ status: 422 });
  });
});

describe('client jsonrpc over ws', () => {
  it('message projection call', async () => {
    const api = bindJsonrpc(rpcComposer);
    // пара loopback-сокетов: client ↔ server
    const clientSock = makeSocket();
    const serverSock = makeSocket();
    clientSock.send = (d) => { void serverSock.emit(d); };
    serverSock.send = (d) => { void clientSock.emit(d); };
    serveWs(api, serverSock);
    const rpc = jsonrpc<typeof api>({ socket: clientSock });
    expect(await rpc.Math.add({ a: 2, b: 3 })).toBe(5);
  });
});

// Минимальный loopback-сокет (интерфейс Socket из src).
function makeSocket() {
  let handler: ((data: string | Uint8Array) => void | Promise<void>) | undefined;
  return {
    send(_data: string | Uint8Array) {},
    onMessage(h: (data: string | Uint8Array) => void | Promise<void>) { handler = h; },
    emit(data: string | Uint8Array) { return handler?.(data); },
  };
}