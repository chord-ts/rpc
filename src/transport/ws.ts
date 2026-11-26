// WebSocket: message-проекция ↔ фреймы сокета; stream-проекция ↔ фрейм-подписка.
// Per-platform entry (@chord-ts/rpc/transport/ws). Format codec'ит фрейм (text/bytes).
// null-ответ (notification) → фрейм не шлётся. Ошибка стрима — нативный throw → error-фрейм.
// Decode/handle обёрнуты в try: битый фрейм не роняет процесс unhandled rejection'ом.

import type { MessageProtocol, StreamProtocol } from '../types';
import type { Format } from '../format/types';
import { CoreError } from '../core/types';
import { json } from '../format';

export interface Socket {
  send(data: string | Uint8Array): void;
  onMessage(handler: (data: string | Uint8Array) => void | Promise<void>): void;
  /** Optional close hook: adapters clean up subscriptions / reject pending calls when provided. */
  onClose?(handler: () => void): void;
}

export function fromWs(binding: MessageProtocol & { format?: Format<any> }, socket: Socket, opts: { format?: Format<any> } = {}): void {
  const format = opts.format ?? binding.format ?? json;
  socket.onMessage(async (data) => {
    let value: unknown;
    try {
      value = format.decode(data); // фрейм → значение
    } catch {
      socket.send(format.encode({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    try {
      const reply = await binding.message.handle(value);
      if (reply != null) socket.send(format.encode(reply)); // значение → фрейм; null → не слать
    } catch {
      socket.send(format.encode({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
    }
  });
}

// Одна активная подписка на сокет (мультиплексирование по id — следующий шаг).
export function fromWsStream(binding: StreamProtocol & { format?: Format<any> }, socket: Socket, opts: { format?: Format<any> } = {}): void {
  const format = opts.format ?? binding.format ?? json;
  let active: AsyncIterator<unknown> | undefined;
  let closed = false;
  socket.onClose?.(() => {
    closed = true;
    const it = active;
    active = undefined;
    void it?.return?.(); // return() → finally генератора (cleanup) even on abrupt close
  });
  socket.onMessage(async (data) => {
    let value: { cancel?: boolean } | null;
    try {
      value = format.decode(data) as { cancel?: boolean } | null;
    } catch {
      return; // malformed subscription frame: nothing to correlate, drop it
    }
    if (value?.cancel) {
      const it = active;
      active = undefined;
      await it?.return?.(); // return() → finally генератора (cleanup)
      return;
    }
    const prev = active;
    const it = binding.stream.handle(value)[Symbol.asyncIterator]();
    active = it; // синхронно: cancel-фрейм сразу за подпиской уже видит итератор
    await prev?.return?.(); // новая подписка вытесняет старую
    try {
      for (;;) {
        const { value: event, done } = await it.next();
        if (done || closed) break;
        socket.send(format.encode(event));
      }
    } catch (e) {
      // CoreError messages are intentional (validation); unexpected errors → generic, no leak.
      if (!closed) socket.send(format.encode({ error: e instanceof CoreError ? e.message : 'Internal error' }));
    } finally {
      if (active === it) active = undefined;
    }
  });
}
