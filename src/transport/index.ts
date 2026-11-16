// Transport layer: thin, protocol-agnostic adapters. They only shuttle bytes into a Binding —
// no knowledge of the protocol. Imports the Binding contract + types. fetch adapters use the
// DOM lib (Response); express adapter is structural (no node types needed).

import type { Binding, TransportRequest } from '../types';

/** SvelteKit / any fetch-runtime: event.request + event.locals → Response. */
export async function fromSvelteKit(
  binding: Binding,
  event: { request: TransportRequest; locals?: unknown },
): Promise<Response> {
  const r = await binding.handle(event.request, event.locals);
  return new Response(r.body, { status: r.status, headers: r.headers });
}

// Express: structural req/res. express.json() parses the body — text() hands it back.
interface ExpressReq {
  method: string;
  url: string;
  body?: unknown;
  ctx?: unknown;
}
interface ExpressRes {
  status(code: number): ExpressRes;
  set(field: string, value: string): ExpressRes;
  send(body?: string | null): ExpressRes;
}
export async function fromExpress(binding: Binding, req: ExpressReq, res: ExpressRes): Promise<void> {
  const transportReq: TransportRequest = {
    method: req.method,
    url: `http://localhost${req.url}`,
    text: async () => JSON.stringify(req.body ?? null),
  };
  const r = await binding.handle(transportReq, req.ctx);
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.set(k, v);
  res.send(r.body);
}