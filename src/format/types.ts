// Format layer contract: codec pair over the protocol envelope. Raw — тип провода: текст
// (string) по умолчанию, байты (Uint8Array) для бинарных форматов (msgpack/cbor). Не зашит на строки.

export interface Format<Raw = string> {
  contentType: string;
  /** How the adapter reads the body from the platform: text() or arrayBuffer(). */
  unit: 'text' | 'bytes';
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
}