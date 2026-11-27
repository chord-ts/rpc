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

export function fromWs(
  binding: MessageProtocol & { format?: Format<any> },
  socket: Socket,
  opts: { format?: Format<any>; ctx?: unknown } = {},
): void {
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
      const reply = await binding.message.handle(value, opts.ctx); // per-connection ctx → DI/middleware
      if (reply != null) socket.send(format.encode(reply)); // значение → фрейм; null → не слать
    } catch {
      socket.send(format.encode({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
    }
  });
}

// Одна активная подписка на сокет (мультиплексирование по id — следующий шаг).
// Отмена двойная: signal.aborted доходит до обработчика, ждущего внешнего события, а return()
// запускает finally-очистку генератора (очередь за висящим next() — сигнал не ждёт).
export function fromWsStream(
  binding: StreamProtocol & { format?: Format<any> },
  socket: Socket,
  opts: { format?: Format<any>; ctx?: unknown } = {},
): void {
  const format = opts.format ?? binding.format ?? json;
  interface Sub {
    it: AsyncIterator<unknown>;
    ac: AbortController;
    cancelled: boolean;
  }
  let active: Sub | undefined;
  let closed = false;
  const stop = (sub: Sub | undefined): void => {
    if (!sub) return;
    sub.cancelled = true;
    sub.ac.abort();
    // return() → finally генератора (cleanup); a failing cleanup must not crash the process.
    try {
      void Promise.resolve(sub.it.return?.()).catch(() => {});
    } catch {
      // iterator without a working return() — the abort signal already reached the handler
    }
  };
  socket.onClose?.(() => {
    closed = true;
    const sub = active;
    active = undefined;
    stop(sub);
  });
  socket.onMessage(async (data) => {
    let value: unknown;
    try {
      value = format.decode(data);
    } catch {
      return; // malformed subscription frame: nothing to correlate, drop it
    }
    if (value !== null && typeof value === 'object' && (value as { cancel?: boolean }).cancel) {
      const sub = active;
      active = undefined;
      stop(sub);
      return;
    }
    // null / primitive frame: no subscription to build — error frame, never a throw out of handle.
    if (value === null || typeof value !== 'object') {
      socket.send(format.encode({ error: 'Invalid subscription' }));
      return;
    }
    const prev = active;
    const ac = new AbortController();
    let it: AsyncIterator<unknown>;
    try {
      it = binding.stream.handle(value, opts.ctx, ac.signal)[Symbol.asyncIterator]();
    } catch (e) {
      socket.send(format.encode({ error: e instanceof CoreError ? e.message : 'Internal error' }));
      return;
    }
    const sub: Sub = { it, ac, cancelled: false };
    active = sub; // синхронно: cancel-фрейм сразу за подпиской уже видит подписку
    stop(prev); // новая подписка вытесняет старую
    try {
      for (;;) {
        const { value: event, done } = await it.next();
        if (done || closed || sub.cancelled) break;
        socket.send(format.encode(event));
      }
    } catch (e) {
      // CoreError messages are intentional (validation); unexpected errors → generic, no leak.
      // Cancel/close is deliberate — no error frame for the aborted stream.
      if (!closed && !sub.cancelled) socket.send(format.encode({ error: e instanceof CoreError ? e.message : 'Internal error' }));
    } finally {
      if (active === sub) active = undefined;
    }
  });
}
