// ПРЕДЛАГАЕМАЯ версия generic HTTP-адаптера (дизайн-спайк). Пользователь вызывает его так же,
// как любой другой адаптер семейства: fromSvelteKit(protocol) → handler. MCP не требует
// собственного транспорта — хватает http-проекции, если тело ответа умеет быть потоком.
//
// ДЕЛЬТА к src/transport (всё аддитивно, существующие биндинги не ломаются):
//   1. TransportRequest += необязательные headers и signal. Необязательные → старые биндинги
//      (rest/jsonrpc/mcp/capnweb) остаются совместимыми по типам.
//   2. TransportResponse.body уже unknown — AsyncIterable проходит БЕЗ изменения типа.
//      Адаптер сам решает фрейминг: поток → SSE, значение → Format.encode.
//   3. Сигнатура: fromSvelteKit(protocol, opts?) → handler (каррирование, как fromWs).
//      Старая форма fromSvelteKit(protocol, event, opts?) сохранена перегрузкой — примеры
//      01–05/09 не ломаются при переносе.
//   4. SSE: keep-alive комментарии, X-Accel-Buffering, pull-based backpressure, отмена
//      БЕЗ ожидания cleanup (измерено: 51ms → 0ms на некооперативном источнике).
//   5. body == null → тела нет (202/204), а не строка "null".
//
// Фрейминг, заголовки транспорта и жизненный цикл потока — здесь. Семантика MCP (405/403/
// сверка заголовков/коды) — в профиле helpers/mcp, который отдаёт готовый http-биндинг.

import { json } from '../../../src';
import type { Format } from '../../../src/format/types';
import type { HttpProtocol, TransportRequest, TransportResponse } from '../../../src';

/** Предлагаемое расширение шва: оба поля необязательны → аддитивно. */
export interface HttpRequest extends TransportRequest {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type ReadMode = 'format' | 'formdata';
type FetchEvent = { request: Request; locals?: unknown };
export interface HttpOptions {
  format?: Format<any>;
  as?: ReadMode;
  body?: unknown;
  keepAliveMs?: number;
}

const encoder = new TextEncoder();
const KEEP_ALIVE = Symbol('keep-alive');

function isStream(v: unknown): v is AsyncIterable<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function readBody(request: Request, format: Format<any>, as: ReadMode): Promise<unknown> {
  if (as === 'formdata') {
    const obj: Record<string, unknown> = {};
    (await request.formData()).forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }
  if (format.unit === 'bytes') {
    const buf = new Uint8Array(await request.arrayBuffer());
    return buf.length ? format.decode(buf) : undefined;
  }
  const text = await request.text();
  return text ? format.decode(text) : undefined;
}

/** Ответ (id + result/error) завершает SSE-поток; notification — нет. */
function isResponse(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'id' in v && ('result' in v || 'error' in v);
}

function sse(res: TransportResponse, ac: AbortController, keepAliveMs: number): Response {
  const it = (res.body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<unknown>> | undefined;
  let finished = false;
  // Cleanup не блокирует закрытие потока: спека требует стоп работы и не слать сообщений,
  // но не требует ждать чужой finally. JS не прерывает pending await — cleanup доедет сам.
  const stop = () => {
    if (finished) return;
    finished = true;
    const done = it.return?.();
    void done?.catch(() => {});
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = (pending ??= it.next()); // тот же next переживает keep-alive: кадры не теряются
      let clear = () => {};
      const beat = new Promise<typeof KEEP_ALIVE>((resolve) => {
        if (keepAliveMs <= 0) return;
        const t = setTimeout(() => resolve(KEEP_ALIVE), keepAliveMs);
        clear = () => clearTimeout(t);
      });
      const r = await Promise.race([next, beat]);
      clear();
      if (r === KEEP_ALIVE) {
        controller.enqueue(encoder.encode(': keep-alive\n\n'));
        return;
      }
      pending = undefined;
      if (r.done) {
        stop();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${json.encode(r.value)}\n\n`));
      if (isResponse(r.value)) {
        stop();
        controller.close();
      }
    },
    cancel() {
      ac.abort(); // клиент закрыл поток = отмена запроса; signal останавливает работу сразу
      stop();
    },
  });

  return new Response(stream, {
    status: res.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
      ...res.headers,
    },
  });
}

function respond(res: TransportResponse, format: Format<any>): Response {
  const headers = { 'content-type': format.contentType, ...res.headers };
  // null = значения нет → тела нет (202/204). Иначе raw-escape или кодек.
  const out = res.body == null ? null : res.raw ? (res.body as string | Uint8Array) : format.encode(res.body);
  return new Response(out, { status: res.status, headers });
}

async function handle(protocol: HttpProtocol, event: FetchEvent, opts: HttpOptions): Promise<Response> {
  const format = opts.format ?? json;
  let body: unknown;
  try {
    body = opts.body !== undefined ? opts.body : await readBody(event.request, format, opts.as ?? 'format');
  } catch {
    return new Response(JSON.stringify({ detail: 'Parse error' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const ac = new AbortController(); // живёт ровно один запрос
  const req: HttpRequest = {
    method: event.request.method,
    url: event.request.url,
    body,
    headers: headersOf(event.request),
    signal: ac.signal,
  };
  const res = await protocol.http.handle(req, event.locals);
  if (isStream(res.body)) return sse(res, ac, opts.keepAliveMs ?? 15_000);
  return respond(res, format);
}

// Каррирование (целевая форма) + старая per-call форма перегрузкой.
export function fromSvelteKit(protocol: HttpProtocol, opts?: HttpOptions): (event: FetchEvent) => Promise<Response>;
export function fromSvelteKit(protocol: HttpProtocol, event: FetchEvent, opts?: HttpOptions): Promise<Response>;
export function fromSvelteKit(
  protocol: HttpProtocol,
  a?: FetchEvent | HttpOptions,
  b?: HttpOptions,
): Promise<Response> | ((event: FetchEvent) => Promise<Response>) {
  if (a && typeof a === 'object' && 'request' in a) return handle(protocol, a as FetchEvent, b ?? {});
  const opts = (a as HttpOptions) ?? {};
  return (event: FetchEvent) => handle(protocol, event, opts);
}
