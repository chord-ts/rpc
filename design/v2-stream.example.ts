// Пользовательский код: stream — третий глагол, нативные ошибки (без Result).
// Декларация stream({ in, event }); обработчик — async-генератор. Gasket yield'ит голые события,
// ошибки — typed throw (RpcError) / отмена — AbortError; потребитель — for await + try/catch.
// Прогон типов:
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-stream.example.ts

import { z } from 'zod';
import { fn, stream, compose, RpcError } from './v2-stream.helpers';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Ticker {
  constructor() {}

  static $countdown = stream({
    in: z.object({ from: z.number() }),
    event: z.object({ n: z.number() }),
    desc: 'Обратный отсчёт',
  });
  countdown: typeof Ticker.$countdown.fn = async function* ({ from }) {
    try {
      for (let n = from; n > 0; n--) {
        yield { n };
        await delay(5);
      }
    } finally {
      console.log('countdown cleanup');
    }
  };

  static $ping = fn({ in: z.string(), out: z.string() });
  ping: typeof Ticker.$ping.fn = async (s) => `pong:${s}`;
}

const composer = compose({ Ticker }, { inject: {} });

(async () => {
  // Унарный вызов — call (Result, как раньше).
  console.log('call:', await composer.call('Ticker.ping', 'hi'));

  // Stream: голые события, нативный for await.
  console.log('--- stream countdown(3) ---');
  for await (const event of composer.stream('Ticker.countdown', { from: 3 })) {
    console.log('event:', event); // { n: 3 } — без обёртки Result
  }

  // Отмена: abort → AbortError (нативный), cleanup генератора сработает.
  console.log('--- cancelled countdown(5) ---');
  const ac = new AbortController();
  try {
    for await (const event of composer.stream('Ticker.countdown', { from: 5 }, { signal: ac.signal })) {
      console.log('event:', event);
      ac.abort();
    }
  } catch (e) {
    console.log('caught:', (e as Error).name); // AbortError
  }

  // Ошибка валидации входа — typed RpcError (нативный throw).
  console.log('--- invalid input ---');
  try {
    for await (const event of composer.stream('Ticker.countdown', { from: 'x' })) {
      console.log(event);
    }
  } catch (e) {
    console.log('RpcError code:', (e as RpcError).code); // -32602
  }
})();