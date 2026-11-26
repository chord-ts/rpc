// Регрессии по ревью: B7 (вызов без аргументов), B8 (WS-корреляция), H7/B3 (WS-транспорт).

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  compose, fn, jsonrpc as bindJsonrpc, fromSvelteKit, fromWs as serveWs, fromWsStream as serveWsStream, RpcError,
} from '../index';
import type { StreamProtocol } from '../types';
import { jsonrpc } from './index';

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
