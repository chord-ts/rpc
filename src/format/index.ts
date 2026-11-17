// Format layer: codec implementations. Imports only the shared types. The codec is reused by
// protocol, transport and client. Text seam for now; binary formats (msgpack/cbor/ndjson) will
// extend Format to a Uint8Array seam when added (each brings its own dependency).

import type { Format } from './types';

export const json: Format = {
  contentType: 'application/json',
  decode: (raw) => JSON.parse(raw),
  encode: (value) => JSON.stringify(value),
};