// SvelteKit / any fetch-runtime: event.request + event.locals → Response.
// Per-platform entry (@chord-ts/rpc/transport/sveltekit) — изолирует код платформы для tree-shaking.

import type { HttpProtocol, TransportResponse } from '../types';
import type { Format } from '../format/types';
import { json } from '../format';

interface FetchRequest {
  method: string;
  url: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  formData?(): Promise<FormData>;
}

async function readBody(request: FetchRequest, format: Format<any>): Promise<unknown> {
  // formdata: multipart парсит платформа, кодек получает готовый FormData.
  if (format.unit === 'form') return format.decode(await request.formData!());
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
  opts: { format?: Format<any>; body?: unknown } = {},
): Promise<Response> {
  const format = opts.format ?? binding.format ?? json; // эндпоинт — источник формата; opts — override
  let body: unknown;
  try {
    body = opts.body !== undefined ? opts.body : await readBody(event.request, format);
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
  return respond(res, format, event.request.method === 'HEAD');
}

function respond(res: TransportResponse, format: Format<any>, head = false): Response {
  // HEAD (and 204) carry no body; skip encoding entirely for HEAD.
  const out = head || res.status === 204 ? null : res.raw ? (res.body as string | Uint8Array | null) : format.encode(res.body);
  // FormData: the platform sets multipart/form-data WITH the boundary — a manual content-type
  // header (no boundary) would break parsing. Let the Response constructor derive it.
  const headers = out instanceof FormData ? { ...res.headers } : { 'content-type': format.contentType, ...res.headers };
  return new Response(out, { status: res.status, headers });
}