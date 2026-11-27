// SvelteKit / any fetch-runtime: event.request + event.locals → Response.
// Per-platform entry (@chord-ts/rpc/transport/sveltekit) — изолирует код платформы для tree-shaking.

import type { HttpProtocol, TransportResponse } from '../types';
import type { Format } from '../format/types';
import { json } from '../format';

type ReadMode = 'format' | 'formdata';

interface FetchRequest {
  method: string;
  url: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  formData?(): Promise<FormData>;
}

async function readBody(request: FetchRequest, format: Format<any>, as: ReadMode): Promise<unknown> {
  if (as === 'formdata') {
    const obj: Record<string, unknown> = {};
    (await request.formData!()).forEach((v, k) => {
      obj[k] = v; // multipart парсит платформа, поля — значением, без decode
    });
    return obj;
  }
  // Пустое тело (GET/HEAD, docs) — undefined, без decode.
  if (format.unit === 'bytes') {
    const buf = new Uint8Array(await request.arrayBuffer!());
    return buf.length ? format.decode(buf) : undefined;
  }
  const text = await request.text();
  return text ? format.decode(text) : undefined;
}

export async function fromSvelteKit(
  binding: HttpProtocol & { format?: Format<any> },
  event: { request: FetchRequest; locals?: unknown },
  opts: { format?: Format<any>; as?: ReadMode; body?: unknown } = {},
): Promise<Response> {
  const format = opts.format ?? binding.format ?? json; // эндпоинт — источник формата; opts — override
  let body: unknown;
  try {
    body = opts.body !== undefined ? opts.body : await readBody(event.request, format, opts.as ?? 'format');
  } catch {
    // Parse-error — граница адаптера. JSON-RPC-семейство (message-проекция) получает конверт
    // спеки (-32700, id:null); остальные протоколы — {detail}.
    const body =
      'message' in binding
        ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
        : { detail: 'Parse error' };
    return new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const res = await binding.http.handle({ method: event.request.method, url: event.request.url, body }, event.locals);
  return respond(res, format);
}

function respond(res: TransportResponse, format: Format<any>): Response {
  const headers = { 'content-type': format.contentType, ...res.headers };
  const out = res.raw ? (res.body as string | Uint8Array | null) : format.encode(res.body);
  return new Response(res.status === 204 ? null : out, { status: res.status, headers });
}