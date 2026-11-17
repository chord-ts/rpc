// Mock-кодеки Format для демонстрации подмены формата (default json → custom).
// Реальные devalue/msgpack/cbor — drop-in Format тем же контрактом (unit text/bytes).

import type { Format } from '../../src';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Текстовый кодек, умеет Date (заменитель devalue). json Date теряет — devalue восстанавливает. */
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

/** Бинарный кодек (заменитель msgpack/cbor): magic 0xC0DE + uint32 length + utf8-json. */
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