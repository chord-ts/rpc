import { beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { fn, stream, compose, CoreError } from '../index';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanup = vi.fn();
beforeEach(() => cleanup.mockClear());

class Ticker {
  static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
  countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
    try {
      for (let n = from; n > 0; n--) {
        yield { n };
        await delay(1);
      }
    } finally {
      cleanup();
    }
  };

  static $ping = fn({ in: z.string(), out: z.string() });
  ping: typeof Ticker.$ping.fn = async (s) => `pong:${s}`;
}

const composer = compose({ Ticker });

test('stream: голые события по порядку; один compose рядом с fn', async () => {
  expect(await composer.call('Ticker.ping', 'hi')).toBe('pong:hi');
  const events: unknown[] = [];
  for await (const e of composer.stream('Ticker.countdown', { from: 3 })) events.push(e);
  expect(events).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);
  expect(cleanup).toHaveBeenCalled();
});

test('stream: abort → AbortError + cleanup генератора', async () => {
  const ac = new AbortController();
  const seen: unknown[] = [];
  await expect(
    (async () => {
      for await (const e of composer.stream('Ticker.countdown', { from: 5 }, { signal: ac.signal })) {
        seen.push(e);
        ac.abort();
      }
    })(),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(seen.length).toBe(1);
  expect(cleanup).toHaveBeenCalled();
});

test('stream: break потребителя → return() → cleanup', async () => {
  for await (const e of composer.stream('Ticker.countdown', { from: 5 })) {
    expect(e).toEqual({ n: 5 });
    break;
  }
  expect(cleanup).toHaveBeenCalled();
});

test('stream: invalid params → CoreError invalid-params', async () => {
  const it = composer.stream('Ticker.countdown', { from: 'x' });
  await expect(it[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(CoreError);
  await expect(composer.stream('Ticker.countdown', { from: 'x' })[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    kind: 'invalid-params',
  });
});

test('stream: не stream-метод / неизвестный метод → CoreError not-found', async () => {
  await expect(composer.stream('Ticker.ping', 'x')[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'not-found' });
  await expect(composer.stream('Ticker.nope', {})[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'not-found' });
});

test('stream: битое событие → CoreError invalid-output', async () => {
  class Bad {
    static $s = stream({ in: z.unknown(), event: z.object({ n: z.number() }) });
    s: typeof Bad.$s.fn = async function* () {
      yield { n: 'x' as unknown as number }; // битый возврат: тип совпадает, рантайм — нет
    };
  }
  const c = compose({ Bad });
  await expect(c.stream('Bad.s', undefined)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    kind: 'invalid-output',
    message: 'Event validation error',
  });
});

test('call по stream-методу → CoreError (глагол не тот)', async () => {
  await expect(composer.call('Ticker.countdown', { from: 3 })).rejects.toThrow(/is a stream/);
});

test('stream: DI через конструктор — this.ctx доступен в генераторе', async () => {
  class Who {
    constructor(public readonly ctx: { user: string }) {}
    static $who = stream({ in: z.unknown(), event: z.object({ user: z.string() }) });
    who: typeof Who.$who.fn = async function* () {
      yield { user: this.ctx.user };
    };
  }
  const c = compose({ Who }, { inject: { ctx: (e: { user: string }) => e } });
  const events: unknown[] = [];
  for await (const e of c.stream('Who.who', undefined, { ctx: { user: 'alice' } })) events.push(e);
  expect(events).toEqual([{ user: 'alice' }]);
});
