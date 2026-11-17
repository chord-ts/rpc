// Format layer contract: codec pair over the protocol envelope. Raw — тип провода: текст
// (string) по умолчанию, байты (Uint8Array) для бинарных форматов (msgpack/cbor). Не зашит на строки.

export interface Format<Raw = string> {
  contentType: string;
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
}