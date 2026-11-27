// Loopback-сокет для демо WS-адаптеров (fromWs / fromWsStream). Реальный WS — тот же интерфейс
// Socket из src (send/onMessage). Механики message-шова перенесены в src (2026-11-18):
// MessageBinding/проекции — types.ts, jsonrpc/mcp — protocol/jsonrpc, мост — protocol/message.ts,
// fromWs — transport. Здесь остаётся только демо-утилита, не публичный API.

import type { Socket } from '../../../src';

/** Loopback-сокет для демо (реальный WS — тот же интерфейс send/onMessage). */
export class LoopbackSocket implements Socket {
  sent: (string | Uint8Array)[] = [];
  private handler?: (data: string | Uint8Array) => void | Promise<void>;
  send(data: string | Uint8Array) { this.sent.push(data); }
  onMessage(h: (data: string | Uint8Array) => void | Promise<void>) { this.handler = h; }
  emit(data: string | Uint8Array) { return this.handler?.(data); } // входящий фрейм
}
