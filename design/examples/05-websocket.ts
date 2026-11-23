// 05 · WebSocket (продвинутый, в src). WS — самоадресуемый message-шов: jsonrpc отдаёт проекцию
// { message }, fromWs codec'ит фреймы (Format) и зовёт message.handle(value). Адрес внутри конверта
// (body.method), method/url сокета не нужны. HTTP здесь ни при чём: SvelteKit/Request — не про
// сокеты; HTTP-проекция (.http) того же протокола служит HTTP-адаптерам (см. 09).
// Format — опциональная ручка адаптера (default json); кастомный кодек меняет провод, не протокол.
// Переиспользует Math из 01.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/05-websocket.ts

import { compose, jsonrpc, fromWs } from '../../src';
import { json } from '../../src/format';
import { Math } from './shared';
import { LoopbackSocket } from './helpers/message';
import { msgpackMock } from './codecs';

const composer = compose({ Math });
const rpc = jsonrpc(composer); // message-проекция: value → value | null

const addCall = (id: number | undefined) => ({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id });

(async () => {
  // format опционален — default json. Фрейм → decode → message.handle → encode → фрейм.
  const ws = new LoopbackSocket();
  fromWs(rpc, ws);

  // Вызов → ответный фрейм (голое значение, без HTTP-статусов и dummy method/url).
  await ws.emit(JSON.stringify(addCall(1)));
  console.log('05 WS call →', json.decode(ws.sent[0] as string)); // { jsonrpc, id: 1, result: 5 }

  // Notification (id нет) → null → фрейм не шлётся.
  const before = ws.sent.length;
  await ws.emit(JSON.stringify(addCall(undefined)));
  console.log('05 WS notification → фреймов:', ws.sent.length - before); // 0

  // Batch → массив ответов одним фреймом (correlation по id).
  await ws.emit(JSON.stringify([
    { jsonrpc: '2.0', method: 'Math.add', params: { a: 1, b: 1 }, id: 2 },
    { jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 2 }, id: 3 },
  ]));
  console.log('05 WS batch →', json.decode(ws.sent[ws.sent.length - 1] as string)); // [{id:2,result:2},{id:3,result:4}]

  // Кастомный формат: тот же rpc/адаптер, меняется только кодек (бинарные фреймы msgpack).
  const wsBin = new LoopbackSocket();
  fromWs(rpc, wsBin, { format: msgpackMock });
  await wsBin.emit(msgpackMock.encode(addCall(4)));
  console.log('05 WS custom (msgpack) →', msgpackMock.decode(wsBin.sent[0] as Uint8Array)); // { jsonrpc, id: 4, result: 5 }
})();
