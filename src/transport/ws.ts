// WebSocket: message-проекция ↔ фреймы сокета; stream-проекция ↔ фрейм-подписка.
// Per-platform entry (@chord-ts/rpc/transport/ws). Format codec'ит фрейм (text/bytes).
// null-ответ (notification) → фрейм не шлётся. Ошибка стрима — нативный throw → error-фрейм.

import type { MessageProtocol, StreamProtocol } from '../types';
import type { Format } from '../format/types';
import { json } from '../format';

export interface Socket {
  send(data: string | Uint8Array): void;
  onMessage(handler: (data: string | Uint8Array) => void | Promise<void>): void;
}

export function fromWs(binding: MessageProtocol & { format?: Format<any> }, socket: Socket, opts: { format?: Format<any> } = {}): void {
  const format = opts.format ?? binding.format ?? json;
  socket.onMessage(async (data) => {
    const value = format.decode(data); // фрейм → значение
    const reply = await binding.message.handle(value);
    if (reply != null) socket.send(format.encode(reply)); // значение → фрейм; null → не слать
  });
}

// Одна активная подписка на сокет (мультиплексирование по id — следующий шаг).
export function fromWsStream(binding: StreamProtocol & { format?: Format<any> }, socket: Socket, opts: { format?: Format<any> } = {}): void {
  const format = opts.format ?? binding.format ?? json;
  let active: AsyncIterator<unknown> | undefined;
  socket.onMessage(async (data) => {
    const value = format.decode(data) as { cancel?: boolean } | null;
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
        if (done) break;
        socket.send(format.encode(event));
      }
    } catch (e) {
      socket.send(format.encode({ error: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (active === it) active = undefined;
    }
  });
}