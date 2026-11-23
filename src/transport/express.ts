// Express: express.raw() → сырой Buffer; express.json() → уже распарсенный объект.
// Per-platform entry (@chord-ts/rpc/transport/express). Без двойного парсинга: сырой Buffer
// декодируется, готовый объект идёт значением как есть. formdata под express — multer, отдельно.

import type { HttpProtocol } from '../types';
import type { Format } from '../format/types';
import { json } from '../format';

export interface ExpressReq {
  method: string;
  url: string;
  body?: unknown; // Uint8Array (express.raw()) или распарсенный объект (express.json())
  ctx?: unknown;
}
export interface ExpressRes {
  status(code: number): ExpressRes;
  set(field: string, value: string): ExpressRes;
  send(body?: Uint8Array | string | null): ExpressRes;
}

export async function fromExpress(
  binding: HttpProtocol & { format?: Format<any> },
  req: ExpressReq,
  res: ExpressRes,
  opts: { format?: Format<any> } = {},
): Promise<void> {
  const format = opts.format ?? binding.format ?? json;
  let body: unknown;
  try {
    const raw = req.body;
    if (raw instanceof Uint8Array) {
      body = raw.length ? format.decode(format.unit === 'bytes' ? raw : new TextDecoder().decode(raw)) : undefined;
    } else {
      body = raw; // уже значение (express.json() / раннее извлечение) или undefined
    }
  } catch {
    res.status(400).set('content-type', 'application/json').send(JSON.stringify({ detail: 'Parse error' }));
    return;
  }
  const r = await binding.http.handle({ method: req.method, url: `http://localhost${req.url}`, body }, req.ctx);
  res.status(r.status);
  for (const [k, v] of Object.entries({ 'content-type': format.contentType, ...r.headers })) res.set(k, v);
  res.send(r.status === 204 ? null : r.raw ? (r.body as string | Uint8Array) : format.encode(r.body));
}