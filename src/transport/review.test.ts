// Регрессии по второму раунду ревью: WS-адаптеры — null-фрейм не роняет процесс, ctx доходит
// до DI/middleware, cancel/close абортит signal обработчика (return() встаёт за висящим next()).

import { expect, test } from 'vitest';
import { z } from 'zod';
import { compose, fn, stream, jsonrpc } from '../index';
import { fromWs, fromWsStream } from '@/transport';
import { events } from '@/events';

type Handler = (data: string | Uint8Array) => void | Promise<void>;

function makeSocket() {
  const sent: (string | Uint8Array)[] = [];
  let handler: Handler | undefined;
  let closeHandler: (() => void) | undefined;
  return {
    sent,
    send(data: string | Uint8Array) {
      sent.push(data);
    },
    onMessage(h: Handler) {
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

class Math {
  static $count = fn({ in: z.number(), out: z.number() });
  count = Math.$count(async (n) => n + 1);
}

test('review2: fromWsStream — null frame yields an error frame, no unhandled rejection', async () => {
  const s = makeSocket();
  fromWsStream(events(compose({ Math })), s);
  await s.emit('null');
  expect(s.sent.length).toBe(1);
  expect(JSON.parse(s.sent[0] as string)).toEqual({ error: 'Invalid subscription' });
  // процесс дожил до конца теста — необработанного rejection нет
});

test('review2: fromWsStream — primitive frame yields an error frame too', async () => {
  const s = makeSocket();
  fromWsStream(events(compose({ Math })), s);
  await s.emit('42');
  expect(JSON.parse(s.sent[0] as string)).toEqual({ error: 'Invalid subscription' });
});

test('review2: fromWs passes per-connection ctx to middleware/DI', async () => {
  const seen: unknown[] = [];
  const c = compose(
    { Math },
    {
      use: async (ctx, next) => {
        seen.push(ctx);
        return next(ctx);
      },
    },
  );
  const s = makeSocket();
  fromWs(jsonrpc(c), s, { ctx: { user: 'alice' } });
  await s.emit(JSON.stringify({ jsonrpc: '2.0', method: 'Math.count', params: 5, id: 1 }));
  expect(seen[0]).toEqual({ user: 'alice' });
});

// Обработчик, ждущий внешнего события: очистка возможна только через signal (return() в очереди).
function waiterComposer(onClean: () => void) {
  class Waiter {
    static $wait = stream({ in: z.void(), event: z.number() });
    wait = Waiter.$wait(async function* (_input, signal) {
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('The stream was aborted', 'AbortError')));
        });
        yield 1;
      } finally {
        onClean();
      }
    });
  }
  return compose({ Waiter });
}

test('review2: cancel aborts the handler signal and runs cleanup (parked next())', async () => {
  let cleaned = false;
  const s = makeSocket();
  fromWsStream(events(waiterComposer(() => (cleaned = true))), s);
  const p = s.emit(JSON.stringify({ method: 'Waiter.wait' }));
  await new Promise((r) => setTimeout(r, 10)); // generator parked on the external event
  await s.emit(JSON.stringify({ cancel: true }));
  await p;
  expect(cleaned).toBe(true);
  expect(s.sent.length).toBe(0); // deliberate cancel — no error frame
});

test('review2: socket close aborts the handler signal and runs cleanup', async () => {
  let cleaned = false;
  const s = makeSocket();
  fromWsStream(events(waiterComposer(() => (cleaned = true))), s);
  const p = s.emit(JSON.stringify({ method: 'Waiter.wait' }));
  await new Promise((r) => setTimeout(r, 10));
  s.close();
  await p;
  expect(cleaned).toBe(true);
  expect(s.sent.length).toBe(0);
});

test('review2: fromWsStream passes ctx and a displacing subscription aborts the previous one', async () => {
  const seen: unknown[] = [];
  let firstAborted = false;
  class Waiter {
    static $wait = stream({ in: z.void(), event: z.number() });
    wait = Waiter.$wait(async function* (_input, signal) {
      signal.addEventListener('abort', () => (firstAborted = true));
      await new Promise((r) => setTimeout(r, 50));
      yield 1;
    });
  }
  const c = compose(
    { Waiter },
    {
      use: async (ctx, next) => {
        seen.push(ctx);
        return next(ctx);
      },
    },
  );
  const s = makeSocket();
  fromWsStream(events(c), s, { ctx: { user: 'bob' } });
  const p1 = s.emit(JSON.stringify({ method: 'Waiter.wait' }));
  await new Promise((r) => setTimeout(r, 5));
  const p2 = s.emit(JSON.stringify({ method: 'Waiter.wait' }));
  await Promise.all([p1, p2]);
  expect(seen[0]).toEqual({ user: 'bob' });
  expect(firstAborted).toBe(true);
});
