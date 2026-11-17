// 05 · WebSocket (продвинутый). Message-шов: самоадресуемый jsonrpc транспорт-нейтрален —
// один биндинг поверх HTTP (messageToHttp) и WS (wsFromMessage). Переиспользует Math из 01.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/05-websocket.ts

import { compose, fromSvelteKit, json } from '../../src';
import { Math } from './shared';
import { jsonrpcMessage, messageToHttp, wsFromMessage, type Socket } from './helpers/message';

const composer = compose({ Math });
const rpc = jsonrpcMessage(composer); // message-контракт: value → value | null

// Loopback-сокет для демо (реальный WS — тот же интерфейс send/onMessage).
class LoopbackSocket implements Socket {
  sent: (string | Uint8Array)[] = [];
  private handler?: (data: string | Uint8Array) => void | Promise<void>;
  send(data: string | Uint8Array) { this.sent.push(data); }
  onMessage(h: (data: string | Uint8Array) => void | Promise<void>) { this.handler = h; }
  emit(data: string | Uint8Array) { return this.handler?.(data); }
}
const call = (id: number | undefined) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'Math.add', params: { a: 2, b: 3 }, id });

(async () => {
  // HTTP: message-биндинг обёрнут в HTTP-шов → штатный fromSvelteKit.
  const httpRes = await fromSvelteKit(messageToHttp(rpc), {
    request: new Request('http://localhost/rpc', { method: 'POST', body: call(1) }),
  });
  console.log('05 HTTP →', await httpRes.json()); // result: 5

  // WS: ТОТ ЖЕ биндинг напрямую во фреймы (без HTTP-обёртки).
  const ws = new LoopbackSocket();
  wsFromMessage(rpc, ws, { format: json });
  await ws.emit(call(2));
  console.log('05 WS →', json.decode(ws.sent[0] as string)); // result: 5 — тот же результат

  // Notification (id нет) → null → фрейм не шлётся.
  const before = ws.sent.length;
  await ws.emit(call(undefined));
  console.log('05 WS notification → фреймов:', ws.sent.length - before); // 0
})();