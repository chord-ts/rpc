// Регрессии раунда 4: клиентское тело record/union (#3), проверка конверта (#13),
// WS-вызов после close (#13), лог только статус (#19 — покрыт в client/review.test.ts).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, fn, jsonrpc as serverJsonrpc } from '../index';
import { post, rest as serverRest, openapi } from '@/rest';
import { jsonrpc, rest } from '@/client';

test('#3: record body (no properties) is sent flat, not dropped', async () => {
  class Shapes {
    static $meta = post('/meta', { body: z.record(z.string(), z.number()) });
    meta = Shapes.$meta(async (input: Record<string, number>) => input);
  }
  const api = serverRest(compose({ Shapes }));
  const doc = openapi(compose({ Shapes })).document as never;
  let sent: { body?: string } | undefined;
  const client = rest<typeof api>({
    endpoint: 'http://localhost',
    doc,
    fetch: async (_url, init) => {
      sent = init as { body?: string };
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.Shapes.meta({ a: 1, b: 2 });
  expect(JSON.parse(sent!.body!)).toEqual({ a: 1, b: 2 });
});

test('#3: discriminated-union body is sent flat (matches the client types)', async () => {
  class Shapes {
    static $create = post('/create', {
      body: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('square'), s: z.number() }),
      ]),
    });
    create = Shapes.$create(async (input: { kind: string }) => input);
  }
  const api = serverRest(compose({ Shapes }));
  const doc = openapi(compose({ Shapes })).document as never;
  let sent: { body?: string } | undefined;
  const client = rest<typeof api>({
    endpoint: 'http://localhost',
    doc,
    fetch: async (_url, init) => {
      sent = init as { body?: string };
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.Shapes.create({ kind: 'circle', r: 1 });
  expect(JSON.parse(sent!.body!)).toEqual({ kind: 'circle', r: 1 });
});

test('#13: a 2xx non-envelope body rejects instead of resolving undefined', async () => {
  class Math {
    static $ping = fn({ in: z.void(), out: z.string() });
    ping = Math.$ping(async () => 'pong');
  }
  const api = serverJsonrpc(compose({ Math }));
  const foreign = jsonrpc<typeof api>({
    endpoint: 'http://localhost/rpc',
    fetch: async () => new Response(JSON.stringify({ foo: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await expect(foreign.Math.ping()).rejects.toMatchObject({ code: -32700 });
  const empty = jsonrpc<typeof api>({
    endpoint: 'http://localhost/rpc',
    fetch: async () => new Response('', { status: 200 }),
  });
  await expect(empty.Math.ping()).rejects.toMatchObject({ code: -32700 });
});

test('#13: a WS call after close rejects immediately (no hang)', async () => {
  class Math {
    static $ping = fn({ in: z.void(), out: z.string() });
    ping = Math.$ping(async () => 'pong');
  }
  const api = serverJsonrpc(compose({ Math }));
  let closeHandler: (() => void) | undefined;
  const socket = {
    send() {},
    onMessage() {},
    onClose(h: () => void) {
      closeHandler = h;
    },
  };
  const client = jsonrpc<typeof api>({ socket });
  closeHandler!(); // сокет закрыт
  await expect(client.Math.ping()).rejects.toThrow('Socket closed');
});
