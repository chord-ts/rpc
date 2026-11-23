import { expect, test } from 'vitest';
import { z } from 'zod';
import { stream, compose, events, fromSvelteKit } from '../index';

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

// Пересечение моделей на этапе типов (страховка, не исполняется):
function _typeGuards() {
  // @ts-expect-error — у events нет http-проекции: унарный HTTP-адаптер не хостит чистый stream.
  fromSvelteKit(events(composer), { request: new Request('http://localhost/events') });
}
