// Значение-уровневый шов + format-ручка (ПРЕДЛАГАЕМЫЕ контракты, дизайн-спайк).
// Форма одобрена 2026-11-17: format-ручка у generic-адаптера (переименована codec → format). Принципы:
//   1. ПРОТОКОЛ ОДИН. Биндинги ниже — те же jsonrpc/rest, что в src, переведённые на значения
//      (конверт/ошибки переиспользуются из src: toWire/toError). НЕ форки *Value под шов.
//   2. ФОРМАТ — format-ручка ОДНОГО generic-адаптера (default json). Пользователь при желании
//      втыкает свой кодек (devalue/msgpack/cbor/formdata) — как в v1 composer.use(backendAdapter).
//      Подмена формата = смена кодека, НЕ адаптера/биндинга. Никакой матрицы протокол×формат.
//   3. Шов transport↔protocol — значение (unknown). Сырой провод (текст/байты) — деталь
//      кодека+адаптера; протокол и ядро формата не знают.
//
// Прогон типов (вместе с example):
//   npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/v2-value.example.ts

import { ErrorCode, type Core, type RPCRequest } from '../src';
// Конверт и маппинг ошибок — из src (семейство jsonrpc), не дублируются: протокол тот же.
import { toError, toWire } from '../src/protocol/jsonrpc/jsonrpc';

// --- Format: симметричный кодек значений над единицей. unit — как адаптеру читать тело ---

export interface Format<Raw = string> {
  contentType: string;
  unit: 'text' | 'bytes';
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Default-кодек адаптера. */
export const json: Format = {
  contentType: 'application/json',
  unit: 'text',
  decode: (raw) => JSON.parse(raw),
  encode: (value) => JSON.stringify(value),
};

/** Пользовательский кодек (mock-devalue): текст, умеет Date. Реальный devalue — drop-in Format. */
export const devalueMock: Format = {
  contentType: 'application/json',
  unit: 'text',
  decode: (raw) =>
    JSON.parse(raw, (_k, v) => (v && typeof v === 'object' && typeof v.$date === 'string' ? new Date(v.$date) : v)),
  // this[k] — исходное значение ДО Date.toJSON (иначе replacer видит уже ISO-строку).
  encode: (value) =>
    JSON.stringify(value, function (this: Record<string, unknown>, k, v) {
      const raw = this[k];
      return raw instanceof Date ? { $date: raw.toISOString() } : v;
    }),
};

/** Пользовательский бинарный кодек (mock-msgpack): magic 0xC0DE + uint32 length + utf8-json.
 * Реальный msgpack/cbor — drop-in Format<Uint8Array> (unit: 'bytes'). */
export const msgpackMock: Format<Uint8Array> = {
  contentType: 'application/msgpack',
  unit: 'bytes',
  decode: (raw) => {
    if (raw[0] !== 0xc0 || raw[1] !== 0xde) throw new Error('msgpack-mock: bad magic');
    const len = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(2);
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

// --- значение-уровневый шов protocol↔transport ---

export interface ProtocolRequest {
  method: string;
  url: string;
  body: unknown; // распарсенное значение (работа адаптера×кодека)
}
export interface ProtocolResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown; // значение — адаптер кодирует
  raw?: boolean; // escape: body финальный (docs text/html) — мимо кодека
}
export interface Binding {
  handle(req: ProtocolRequest, ctx?: unknown): Promise<ProtocolResponse>;
}

// --- протоколы (те же, что в src, над значениями; конверт/ошибки из src) ---

/** JSON-RPC — один биндинг над значениями. Serialize делает адаптер, не биндинг. */
export function jsonrpc(core: Core<any>): Binding {
  return {
    async handle(req, ctx): Promise<ProtocolResponse> {
      const call = (req.body ?? {}) as RPCRequest;
      const id = call.id ?? null;
      if (!call.method) {
        return { status: 200, body: { jsonrpc: '2.0', id, error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' } } };
      }
      let value: unknown;
      let error;
      try {
        value = await core.call(call.method, call.params, { ctx });
      } catch (e) {
        error = toError(e);
      }
      if (id == null) return { status: 204, body: null }; // notification
      return { status: 200, body: toWire(id, value, error) };
    },
  };
}

/** REST — тот же generic-адаптер обслуживит и его (формат ортогонален протоколу). */
export function rest(core: Core<any>): Binding {
  return {
    async handle(req, ctx): Promise<ProtocolResponse> {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/docs') {
        return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>docs</title>', raw: true };
      }
      if (req.method === 'POST' && url.pathname === '/echo') {
        try {
          return { status: 200, body: await core.call('Svc.echo', req.body, { ctx }) };
        } catch (e) {
          const err = toError(e);
          return { status: err.code === ErrorCode.InvalidParams ? 422 : 500, body: { detail: err.message } };
        }
      }
      return { status: 404, body: { detail: 'Not found' } };
    },
  };
}

// --- ОДИН generic-адаптер: сплав платформы и кодека. format-ручка — точка подмены формата ---
// fetch-runtime (SvelteKit event.request / любой Request). Express мапится так же (express.raw() →
// Buffer, без двойного парсинга); formdata под express — multer, отдельно.

type ReadMode = 'format' | 'formdata';
interface FetchRequest {
  method: string;
  url: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
}

async function readBody(request: FetchRequest, format: Format<any>, as: ReadMode): Promise<unknown> {
  if (as === 'formdata') {
    const obj: Record<string, unknown> = {};
    (await request.formData()).forEach((v, k) => {
      obj[k] = v; // multipart парсит платформа, поля — значением, без decode
    });
    return obj;
  }
  // Пустое тело (GET/HEAD, docs) — undefined, без decode.
  if (format.unit === 'bytes') {
    const buf = new Uint8Array(await request.arrayBuffer());
    return buf.length ? format.decode(buf) : undefined;
  }
  const text = await request.text();
  return text ? format.decode(text) : undefined;
}

export async function fromSvelteKit(
  binding: Binding,
  event: { request: FetchRequest; locals?: unknown },
  opts: { format?: Format<any>; as?: ReadMode } = {},
): Promise<Response> {
  const format = opts.format ?? json; // default json; пользователь втыкает свой кодек сюда
  let body: unknown;
  try {
    body = await readBody(event.request, format, opts.as ?? 'format');
  } catch {
    return new Response(JSON.stringify({ detail: 'Parse error' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const res = await binding.handle({ method: event.request.method, url: event.request.url, body }, event.locals);
  const headers = { 'content-type': format.contentType, ...res.headers };
  const out = res.raw ? (res.body as string | Uint8Array | null) : format.encode(res.body);
  return new Response(res.status === 204 ? null : out, { status: res.status, headers });
}

// --- Express: тот же generic-адаптер, format-ручка. express.raw() → сырой Buffer в req.body ---
// (НЕ express.json() — без двойного парсинга). formdata под express — multer, отдельно.

export interface ExpressReq {
  method: string;
  url: string;
  body?: Uint8Array; // express.raw() кладёт сырой Buffer
  ctx?: unknown;
}
export interface ExpressRes {
  status(code: number): ExpressRes;
  set(field: string, value: string): ExpressRes;
  send(body?: Uint8Array | string | null): ExpressRes;
}

export async function fromExpress(
  binding: Binding,
  req: ExpressReq,
  res: ExpressRes,
  opts: { format?: Format<any> } = {},
): Promise<void> {
  const format = opts.format ?? json;
  let body: unknown;
  try {
    const raw = req.body ?? new Uint8Array();
    body = raw.length ? format.decode(format.unit === 'bytes' ? raw : decoder.decode(raw)) : undefined;
  } catch {
    res.status(400).set('content-type', 'application/json').send(JSON.stringify({ detail: 'Parse error' }));
    return;
  }
  const r = await binding.handle({ method: req.method, url: `http://localhost${req.url}`, body }, req.ctx);
  res.status(r.status);
  for (const [k, v] of Object.entries({ 'content-type': format.contentType, ...r.headers })) res.set(k, v);
  res.send(r.status === 204 ? null : r.raw ? (r.body as string | Uint8Array) : format.encode(r.body));
}