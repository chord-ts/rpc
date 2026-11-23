// 10 · Stream-проекция (продвинутый, в src). Третья модель взаимодействия добавлена аддитивно:
// StreamBinding/StreamProtocol + протокол events + адаптер fromWsStream — при этом
// rest/jsonrpc/mcp/capnweb и fromSvelteKit/fromExpress/fromWs не менялись. Один compose:
// fn и stream рядом. Пересечение моделей — на этапе типов; способности — spread проекций.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/10-stream-projection.ts

import { compose, jsonrpc, fromSvelteKit, fromWs, fromWsStream } from '../../src';
import { json } from '../../src/format';
import { events } from '../../src/events';
import { ZodAdapter } from '../../src/schemas/zod';
import { Math, Ticker } from './shared';
import { LoopbackSocket } from './helpers/message';

const composer = compose({ Math, Ticker }, { inject: {}, schemas: new ZodAdapter() });

const rpc = jsonrpc(composer); // унарный протокол — не изменился
const ev = events(composer); // stream-протокол — только stream-проекция

(async () => {
  // 1. Старое работает как раньше: jsonrpc → WS (адаптер не менялся).
  const ws = new LoopbackSocket();
  fromWs(rpc, ws, { format: json });
  await ws.emit(JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 1 }));
  console.log('10 jsonrpc → WS (как раньше) →', json.decode(ws.sent[0] as string)); // result: 5

  // 2. Новый протокол → новый адаптер: подписка → поток событий (+ cleanup генератора в логе).
  const sub = new LoopbackSocket();
  fromWsStream(ev, sub, { format: json });
  await sub.emit(JSON.stringify({ method: 'Ticker.countdown', params: { from: 3 } }));
  console.log('10 events → WS stream →', sub.sent.map((f) => json.decode(f as string))); // [{n:3},{n:2},{n:1}]

  // 3. Отмена: control-фрейм {cancel:true} → return() итератора. Cancel сразу за подпиской
  //    (синхронно, до первого события) → генератор не стартовал, 0 фреймов.
  const cancelled = new LoopbackSocket();
  fromWsStream(ev, cancelled, { format: json });
  const p = cancelled.emit(JSON.stringify({ method: 'Ticker.countdown', params: { from: 3 } }));
  await cancelled.emit(JSON.stringify({ cancel: true }));
  await p;
  console.log('10 cancel → фреймов:', cancelled.sent.length); // 0

  // 4. Ошибка стрима — нативный throw → error-фрейм (wire ошибок задаёт протокол/транспорт).
  const err = new LoopbackSocket();
  fromWsStream(ev, err, { format: json });
  await err.emit(JSON.stringify({ method: 'Ticker.countdown', params: { from: 'x' } }));
  console.log('10 invalid →', json.decode(err.sent[0] as string)); // { error: 'Validation error' }

  // 5. Композиция способностей: spread проекций — один протокол хостится обоими адаптерами.
  const hybrid = { ...rpc, ...ev }; // message/http от jsonrpc + stream от events
  const h1 = new LoopbackSocket();
  fromWs(hybrid, h1, { format: json });
  await h1.emit(JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id: 2 }));
  const h2 = new LoopbackSocket();
  fromWsStream(hybrid, h2, { format: json });
  await h2.emit(JSON.stringify({ method: 'Ticker.countdown', params: { from: 2 } }));
  console.log('10 hybrid message →', json.decode(h1.sent[0] as string)); // result: 5
  console.log('10 hybrid stream →', h2.sent.map((f) => json.decode(f as string))); // [{n:2},{n:1}]
})();

// Пересечение моделей на этапе типов (страховки, не исполняются):
function _typeGuards() {
  // @ts-expect-error — у jsonrpc нет stream-проекции: старый протокол не умеет новую модель.
  fromWsStream(rpc, new LoopbackSocket());
  // @ts-expect-error — у events нет http-проекции: унарный HTTP-адаптер не хостит чистый stream.
  fromSvelteKit(ev, { request: new Request('http://localhost/events') });
}
