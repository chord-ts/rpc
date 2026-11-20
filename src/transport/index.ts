// Transport layer: ONE generic adapter per platform, with a format-ручка (default json).
// The adapter is the fusion of platform and Format (v1 backendAdapter pattern): it reads the raw
// body (text/arrayBuffer/formData per Format.unit), decodes to a VALUE, calls the value-level
// Binding, encodes the response value back, writes to the platform. Format swap = change the
// codec, not the adapter/binding. No protocol×format matrix. Protocol/format-agnostic otherwise.
// Early extraction: pass a pre-parsed `body` (or express.json() object) — decode is skipped,
// Format then only encodes the response.
// Adapters own the transport contract and consume the protocol's projection: HTTP adapters
// require { http }, fromWs requires { message }, fromWsStream requires { stream }. The protocol
// hands over the contract it built (message protocols bridge via messageToHttp inside the
// factory) — no user-written bindings.

import type { HttpProtocol, MessageProtocol, StreamProtocol, TransportResponse } from '../types';
import type { Format } from '../format/types';
import { json } from '../format';

type ReadMode = 'format' | 'formdata';

// --- SvelteKit / any fetch-runtime: event.request + event.locals → Response ---

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
    // Parse-error — граница адаптера (протокол-агностично).
    return new Response(JSON.stringify({ detail: 'Parse error' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const res = await binding.http.handle({ method: event.request.method, url: event.request.url, body }, event.locals);
  return respond(res, format);
}

function respond(res: TransportResponse, format: Format<any>): Response {
  const headers = { 'content-type': format.contentType, ...res.headers };
  const out = res.raw ? (res.body as string | Uint8Array | null) : format.encode(res.body);
  return new Response(res.status === 204 ? null : out, { status: res.status, headers });
}

// --- Express: express.raw() → сырой Buffer; express.json() → уже распарсенный объект ---
// Без двойного парсинга: сырой Buffer декодируется, готовый объект идёт значением как есть.
// formdata под express — multer, отдельно.

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

// --- WebSocket: message-проекция ↔ фреймы сокета. Format codec'ит фрейм (text/bytes).
// null-ответ (notification) → фрейм не шлётся. Серверный push (stream) — отдельная модель, позже.

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

// --- WebSocket stream: фрейм-подписка → события; {cancel:true} → return() итератора (cleanup).
// Одна активная подписка на сокет (мультиплексирование по id — следующий шаг). Ошибка стрима —
// нативный throw → error-фрейм (wire ошибок — конвенция адаптера, протокол может задать свою).

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