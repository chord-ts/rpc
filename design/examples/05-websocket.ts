// 05 · WebSocket (продвинутый). Message-шов в src: самоадресуемый jsonrpc отдаёт проекции
// { message, http } — один протокол поверх HTTP (fromSvelteKit) и WS (fromWs). Переиспользует Math из 01.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/05-websocket.ts

import { compose, jsonrpc, fromSvelteKit, fromWs, json } from '../../src';
import { Math } from './shared';
import { LoopbackSocket } from './helpers/message';

const composer = compose({ Math });
const rpc = jsonrpc(composer); // проекции: message (value → value | null) + http (встроенный мост)

const call = (id: number | undefined) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id });

(async () => {
  // HTTP: адаптер берёт http-проекцию (мост встроен в фабрику протокола).
  const httpRes = await fromSvelteKit(rpc, {
    request: new Request('http://localhost/rpc', { method: 'POST', body: call(1) }),
  });
  console.log('05 HTTP →', await httpRes.json()); // result: 5

  // WS: тот же протокол, message-проекция напрямую во фреймы (без HTTP-обёртки).
  const ws = new LoopbackSocket();
  fromWs(rpc, ws, { format: json });
  await ws.emit(call(2));
  console.log('05 WS →', json.decode(ws.sent[0] as string)); // result: 5 — тот же результат

  // Notification (id нет) → null → фрейм не шлётся.
  const before = ws.sent.length;
  await ws.emit(call(undefined));
  console.log('05 WS notification → фреймов:', ws.sent.length - before); // 0
})();
