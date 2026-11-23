// AsyncAPI 3.0 — генератор stream/event-протокола (co-location). Транзитивен stream: канал на
// stream-эндпоинт (contract.event); send = params (in), receive = event. Импортит generate/core.

import type { AnySchema } from '@/types';
import type { Core } from '@/core/types';
import { converter, infoOf, serveSpec, type GenOptions, type Spec, type StreamMeta } from '@/generate/core';

export function asyncapi(core: Core<any>, opts: GenOptions = {}): Spec {
  const toJson = converter(opts, core);
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};

  for (const e of core.endpoints()) {
    if (!e.contract?.event) continue;
    const ch = (e.contract.stream as StreamMeta | undefined)?.channel ?? `${e.service}.${e.method}`;
    channels[ch] = {
      address: ch,
      messages: {
        params: { payload: toJson(e.contract.in) },
        event: { payload: toJson(e.contract.event) },
      },
    };
    operations[`${ch}.send`] = {
      action: 'send',
      channel: { $ref: `#/channels/${ch}` },
      messages: [{ $ref: `#/channels/${ch}/messages/params` }],
    };
    operations[`${ch}.receive`] = {
      action: 'receive',
      channel: { $ref: `#/channels/${ch}` },
      messages: [{ $ref: `#/channels/${ch}/messages/event` }],
    };
  }

  return serveSpec({ asyncapi: '3.0.0', info: infoOf(opts), channels, operations });
}