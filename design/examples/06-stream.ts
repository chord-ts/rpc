// 06 · Stream (продвинутый). Третий глагол: stream({ in, event }), обработчик — async-генератор.
// Голые события, нативные ошибки (CoreError) / отмена (AbortError). Переиспользует Ticker.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/06-stream.ts

import { compose, CoreError } from './helpers/stream';
import { Ticker } from './shared';

const composer = compose({ Ticker }, { inject: {} });

(async () => {
  // Унарный вызов — call (значение, ошибки нативно).
  console.log('06 call →', await composer.call('Ticker.ping', 'hi')); // pong:hi

  // Stream: голые события, нативный for await.
  console.log('06 stream countdown(3):');
  for await (const event of composer.stream('Ticker.countdown', { from: 3 })) {
    console.log('  event:', event); // { n: 3 }, { n: 2 }, { n: 1 }
  }

  // Отмена: abort → AbortError, cleanup генератора (finally) сработает.
  const ac = new AbortController();
  try {
    for await (const event of composer.stream('Ticker.countdown', { from: 5 }, { signal: ac.signal })) {
      console.log('  event:', event);
      ac.abort();
    }
  } catch (e) {
    console.log('06 cancelled →', (e as Error).name); // AbortError
  }

  // Ошибка валидации входа — typed CoreError.
  try {
    for await (const event of composer.stream('Ticker.countdown', { from: 'x' })) console.log(event);
  } catch (e) {
    console.log('06 invalid →', (e as CoreError).kind); // invalid-params
  }
})();