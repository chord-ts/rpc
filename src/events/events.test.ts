import { expect, test } from 'vitest';
import { z } from 'zod';
import { stream, compose, fromSvelteKit } from '../index';
import { events, asyncapi } from '@/events';
import { ZodAdapter } from '../schemas/zod';

class Ticker {
  static $countdown = stream({ in: z.object({ from: z.number() }), event: z.object({ n: z.number() }) });
  countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
    for (let n = from; n > 0; n--) yield { n };
  };
}

const composer = compose({ Ticker });

test('events: подписка {method,params} → поток; только stream-проекция', async () => {
  const protocol = events(composer);
  expect(protocol).toHaveProperty('stream');
  expect(protocol).not.toHaveProperty('http');
  expect(protocol).not.toHaveProperty('message');

  const seen: unknown[] = [];
  for await (const e of protocol.stream.handle({ method: 'Ticker.countdown', params: { from: 2 } })) seen.push(e);
  expect(seen).toEqual([{ n: 2 }, { n: 1 }]);
});

test('events: неизвестный метод → нативный CoreError', async () => {
  const it = events(composer).stream.handle({ method: 'Ticker.nope' });
  await expect(it[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'not-found' });
});

test('C13/C14: AsyncAPI params use the input side; channel $ref escapes / and ~', () => {
  class Ch {
    static $s = stream({
      in: z.object({ n: z.number().default(1) }),
      event: z.object({ v: z.number() }),
      stream: { channel: 'room/42~x' },
    });
    s = Ch.$s(async function* () {
      yield { v: 1 };
    });
  }
  const doc = asyncapi(compose({ Ch }, { schemas: new ZodAdapter() })).document as {
    channels: Record<string, { messages: { params: { payload: { required?: string[] } } } }>;
    operations: Record<string, { channel: { $ref: string } }>;
  };
  // input side: .default() makes n optional (output side would mark it required).
  expect(doc.channels['room/42~x'].messages.params.payload.required ?? []).not.toContain('n');
  // JSON Pointer: '~' → '~0', '/' → '~1'.
  expect(doc.operations['room/42~x.send'].channel.$ref).toBe('#/channels/room~142~0x');
});

// Пересечение моделей на этапе типов (страховка, не исполняется):
function _typeGuards() {
  // @ts-expect-error — у events нет http-проекции: унарный HTTP-адаптер не хостит чистый stream.
  fromSvelteKit(events(composer), { request: new Request('http://localhost/events') });
}
