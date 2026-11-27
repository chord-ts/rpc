// Format layer: codec implementations. Imports only the shared types. The codec is reused by
// protocol, transport and client. Text seam for now; binary formats (msgpack/cbor/ndjson) will
// extend Format to a Uint8Array seam when added (each brings its own dependency).

import type { Format, JsonWire, FormWire } from './types';

export const json: Format<string, JsonWire> = {
  contentType: 'application/json',
  unit: 'text',
  decode: (raw) => JSON.parse(raw),
  encode: (value) => JSON.stringify(value),
};

/** Native multipart codec. The platform parses the wire (request.formData() / res.formData());
 * the codec converts FormData ↔ a flat value. Scalars become strings, Blob/File pass through,
 * arrays become repeated fields, nested objects become JSON strings (see FormWire). */
export const formdata: Format<FormData, FormWire> = {
  contentType: 'multipart/form-data',
  unit: 'form',
  decode(raw) {
    // Null prototype: a `__proto__` field must become an own key, not set the object's prototype.
    // Repeated fields collect into an array (a lone field stays a scalar).
    const obj: Record<string, unknown> = Object.create(null);
    raw.forEach((v, k) => {
      if (k in obj) {
        const cur = obj[k];
        obj[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
      } else {
        obj[k] = v;
      }
    });
    return obj;
  },
  encode(value) {
    const fd = new FormData();
    if (value === null || value === undefined) return fd;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('[chord] formdata encode: the wire value must be an object');
    }
    const append = (k: string, v: unknown): void => {
      if (v === undefined) return;
      if (v instanceof Blob) fd.append(k, v);
      else if (v instanceof Date) fd.append(k, v.toISOString());
      else if (v !== null && typeof v === 'object') fd.append(k, JSON.stringify(v));
      else fd.append(k, String(v));
    };
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) v.forEach((item) => append(k, item));
      else append(k, v);
    }
    return fd;
  },
};