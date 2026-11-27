// AsyncAPI 3.0 — генератор stream/event-протокола (co-location). Транзитивен stream: канал на
// stream-эндпоинт (contract.event); send = params (in), receive = event. Импортит generate/core.

import type { AnySchema } from '@/types';
import type { Core } from '@/core/types';
import { converter, infoOf, serveSpec, type GenOptions, type Spec, type StreamMeta } from '@/generate/core';

// JSON Pointer (RFC 6901): '~' → '~0', '/' → '~1' — a channel address with slashes must not
// break the $ref path. Channel/operation KEYS stay raw; only the pointer is escaped.
const pointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

export function asyncapi(core: Core<any>, opts: GenOptions = {}): Spec {
  const toJson = converter(opts, core);
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};

  for (const e of core.endpoints()) {
    if (!e.contract?.event) continue;
    const ch = (e.contract.stream as StreamMeta | undefined)?.channel ?? `${e.service}.${e.method}`;
    const ref = pointer(ch);
    channels[ch] = {
      address: ch,
      messages: {
        // params — input side (defaults/transforms applied on the way in); event — output.
        params: { payload: toJson(e.contract.in, 'input') },
        event: { payload: toJson(e.contract.event) },
      },
    };
    operations[`${ch}.send`] = {
      action: 'send',
      channel: { $ref: `#/channels/${ref}` },
      messages: [{ $ref: `#/channels/${ref}/messages/params` }],
    };
    operations[`${ch}.receive`] = {
      action: 'receive',
      channel: { $ref: `#/channels/${ref}` },
      messages: [{ $ref: `#/channels/${ref}/messages/event` }],
    };
  }

  return serveSpec({ asyncapi: '3.0.0', info: infoOf(opts), channels, operations });
}