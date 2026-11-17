// Байтовый транспортный шов — вариант A (ПРЕДЛАГАЕМЫЕ контракты, дизайн-спайк).
// Решение пользователя 2026-11-17: «Давай A, оформи спайк».
// Идея: провод физически байтовый, шов несёт Uint8Array; текст — это байты + charset.
// Единицу провода задаёт Format (Format<Uint8Array> на границе биндинга), а не шов.
// Биндинг не текстовизирует запрос преждевременно: req.bytes() → format.decode(raw).
//
// Отличие от src (пока текстовый шов): TransportRequest.text() → bytes(),
// TransportResponse.body: string | null → Uint8Array | null, Format<Raw = string> → Raw = Uint8Array.
// Ядро (compose/fn/Core) НЕ меняется — байтовый шов живёт только в protocol/transport/format.
// Конверт/маппинг ошибок переиспользуются из src (toError), не копируются.
//
// Прогон типов (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-bytes.example.ts

import { ErrorCode, type Core, type ErrorObject, type RPCId } from '../src';
// toError — внутренний хелпер семейства jsonrpc (kind → код); берём напрямую, не дублируем.
import { toError } from '../src/protocol/jsonrpc/jsonrpc';

// --- байтовый шов (предлагаемые контракты вместо текстовых в src/types) ---

export interface TransportRequest {
  method: string; // HTTP method
  url: string; // full URL (pathname + query)
  bytes(): Promise<Uint8Array>; // сырое тело — единица провода
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | null;
}
export interface Binding {
  handle(req: TransportRequest, ctx?: unknown): Promise<TransportResponse>;
}

// --- Format: граница биндинга — Uint8Array (предлагаемый дефолт вместо string) ---
// Generic по Raw сохраняется для композиции кодеков, но шов фиксирует Raw = Uint8Array.

export interface Format<Raw = Uint8Array> {
  contentType: string;
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Текстовый json-кодек поверх байтов: TextDecoder/TextEncoder внутри. */
export const json: Format = {
  contentType: 'application/json',
  decode: (raw) => JSON.parse(decoder.decode(raw)),
  encode: (value) => encoder.encode(JSON.stringify(value)),
};

/** Mock-бинарный кодек — заменитель msgpack/cbor для спайка (без зависимостей).
 * Провод: magic 0xC0DE + uint32 length + utf8-json payload. Тело НЕ валидный json-текст —
 * доказывает, что шов несёт непрозрачные байты, а кодек сменяем. Реальный msgpack/cbor
 * встанет сюда тем же контрактом Format<Uint8Array>. */
export const mockBinary: Format = {
  contentType: 'application/vnd.chord.mock',
  decode: (raw) => {
    if (raw[0] !== 0xc0 || raw[1] !== 0xde) throw new Error('mock-binary: bad magic');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const len = view.getUint32(2);
    return JSON.parse(decoder.decode(raw.subarray(6, 6 + len)));
  },
  encode: (value) => {
    const payload = encoder.encode(JSON.stringify(value));
    const out = new Uint8Array(6 + payload.length);
    out[0] = 0xc0;
    out[1] = 0xde;
    new DataView(out.buffer).setUint32(2, payload.length);
    out.set(payload, 6);
    return out;
  },
};

// --- минимальный jsonrpc-биндинг над байтовым шовом ---
// Унарный вызов (batch/rpc.discover ортогональны шву и покрыты src-тестами) — спайк изолирует
// именно дельту шва. Конверт и маппинг ошибок — как в src, но тело codec'ится в байты.

const wireError = (format: Format, id: RPCId, code: number, message: string): TransportResponse => ({
  status: 200,
  headers: { 'content-type': format.contentType },
  body: format.encode({ jsonrpc: '2.0', id, error: { code, message } }),
});

export function jsonrpcBytes(core: Core<any>, opts?: { format?: Format }): Binding {
  const format = opts?.format ?? json;
  return {
    async handle(req, ctx): Promise<TransportResponse> {
      let body: { method: string; params?: unknown; id?: RPCId };
      try {
        body = format.decode(await req.bytes()) as typeof body;
      } catch {
        return wireError(format, null, ErrorCode.ParseError, 'Parse error');
      }
      const id = body.id ?? null;
      let value: unknown;
      let error: ErrorObject | undefined;
      try {
        value = await core.call(body.method, body.params, { ctx });
      } catch (e) {
        error = toError(e); // CoreError.kind → код, ошибки обработчика → InternalError
      }
      if (id == null) return { status: 204, headers: {}, body: null }; // notification — без ответа
      const wire = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result: value };
      return { status: 200, headers: { 'content-type': format.contentType }, body: format.encode(wire) };
    },
  };
}

// --- транспортные адаптеры: байты мапятся нативно ---

/** SvelteKit / fetch-runtime: arrayBuffer → Uint8Array; Response принимает байты как есть. */
export async function fromSvelteKit(
  binding: Binding,
  event: { request: { method: string; url: string; arrayBuffer(): Promise<ArrayBuffer> }; locals?: unknown },
): Promise<Response> {
  const req: TransportRequest = {
    method: event.request.method,
    url: event.request.url,
    bytes: async () => new Uint8Array(await event.request.arrayBuffer()),
  };
  const r = await binding.handle(req, event.locals);
  return new Response(r.body, { status: r.status, headers: r.headers });
}

// Express: express.raw() даёт Buffer (Uint8Array) — сырое тело без двойного парсинга
// (текущий src-костыль JSON.stringify(req.body) больше не нужен).
// REST-доки (text/html) в байтовом шве: TextEncoder.encode(html) — не negotiated format.
interface ExpressReq {
  method: string;
  url: string;
  body?: Uint8Array;
  ctx?: unknown;
}
interface ExpressRes {
  status(code: number): ExpressRes;
  set(field: string, value: string): ExpressRes;
  send(body?: Uint8Array | null): ExpressRes;
}
export async function fromExpress(binding: Binding, req: ExpressReq, res: ExpressRes): Promise<void> {
  const transportReq: TransportRequest = {
    method: req.method,
    url: `http://localhost${req.url}`,
    bytes: async () => req.body ?? new Uint8Array(),
  };
  const r = await binding.handle(transportReq, req.ctx);
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.set(k, v);
  res.send(r.body);
}