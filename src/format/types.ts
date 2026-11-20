// Format layer contract: codec pair over the protocol envelope. Raw — тип провода: текст
// (string) по умолчанию, байты (Uint8Array) для бинарных форматов (msgpack/cbor). Не зашит на строки.
// F — wire-эффект формата: type-level трансформация значений, переживающих провод (json: Date→string).
// Эффект течёт из эндпоинта в клиент и защищает тип возврата от расхождения с форматом.

/** Type-level функция wire-эффекта (higher-kinded через интерфейс). Бренд отличает форматы
 * номинально: без него фантомы структурно совместимы (__out при незаполненном __arg → unknown). */
export interface WireFn {
  readonly __arg?: unknown;
  readonly __out?: unknown;
  readonly __brand?: string;
}
/** Применить wire-эффект F к типу T. NonNullable снимает undefined опционального фантома __out. */
export type ApplyWire<F extends WireFn, T> = NonNullable<(F & { readonly __arg: T })['__out']>;

/** json: Date не переживает JSON → string; рекурсивно по объектам/массивам. */
export interface JsonWire extends WireFn {
  readonly __brand: 'json';
  readonly __out?: JsonWireOf<this['__arg']>;
}
export type JsonWireOf<T> = T extends Date
  ? string
  : T extends (...args: any[]) => any
    ? T
    : T extends (infer U)[]
      ? JsonWireOf<U>[]
      : T extends object
        ? { [K in keyof T]: JsonWireOf<T[K]> }
        : T;

export interface Format<Raw = string, F extends WireFn = WireFn> {
  contentType: string;
  /** How the adapter reads the body from the platform: text() or arrayBuffer(). */
  unit: 'text' | 'bytes';
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
  /** Фантом wire-эффекта (runtime-поля нет). */
  readonly __wire?: F;
}

/** Фантом формата в типе эндпоинта: клиент выводит F отсюда и сверяет формат транспорта. */
export interface FormatTag<F extends WireFn> {
  readonly __format?: F;
}