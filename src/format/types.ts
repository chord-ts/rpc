// Format layer contract: codec pair over the protocol envelope. Raw — тип провода: текст
// (string) по умолчанию, байты (Uint8Array) для бинарных форматов (msgpack/cbor), FormData для
// multipart (парсит платформа). Не зашит на строки.
// F — wire-эффект формата: type-level трансформация значений, переживающих провод (json: Date→string).
// Эффект течёт из эндпоинта в клиент и защищает тип возврата от расхождения с форматом.

/** Type-level функция wire-эффекта (higher-kinded через интерфейс). Бренд отличает форматы
 * номинально: без него фантомы структурно совместимы (__out при незаполненном __arg → unknown). */
export interface WireFn {
  readonly __arg?: unknown;
  readonly __out?: unknown;
  readonly __brand?: string;
}
/** Применить wire-эффект F к типу T. Exclude снимает undefined опционального фантома __out,
 * но сохраняет легитимный null (NonNullable стирал бы и его — null — валидный возврат). */
export type ApplyWire<F extends WireFn, T> = Exclude<(F & { readonly __arg: T })['__out'], undefined>;

/** json: Date не переживает JSON → string; рекурсивно по объектам/массивам. */
export interface JsonWire extends WireFn {
  readonly __brand: 'json';
  readonly __out?: JsonWireOf<this['__arg']>;
}
// Гомоморфный mapped type сохраняет массивы и кортежи (ветка `(infer U)[]` сплющивала кортеж
// [number, Date] в (string|number)[]); объекты/массивы/кортежи идут через keyof-отображение.
export type JsonWireOf<T> = T extends Date
  ? string
  : T extends (...args: any[]) => any
    ? T
    : T extends object
      ? { [K in keyof T]: JsonWireOf<T[K]> }
      : T;

/** formdata: multipart плоский — скаляры становятся строками (String(v)), Date → ISO-строка,
 * вложенные объекты → JSON-строка; Blob/File переживают провод как есть. Повторяющиеся поля —
 * массивы. undefined не кодируется (поле отсутствует). */
export interface FormWire extends WireFn {
  readonly __brand: 'form';
  readonly __out?: FormWireOf<this['__arg']>;
}
// Провод одного поля: Blob/File как есть, Date/скаляр → string, массив → массив проводов
// элементов (повторяющиеся поля), вложенный объект → JSON-string (плоский провод, не рекурсия).
type FormFieldWire<T> = T extends Blob
  ? T
  : T extends Date
    ? string
    : T extends ReadonlyArray<infer U>
      ? FormFieldWire<U>[]
      : T extends object
        ? string
        : T extends string | undefined
          ? T
          : string;
// Гомоморфный mapped type сохраняет опциональность полей (undefined → поле отсутствует).
export type FormWireOf<T> = T extends object ? { [K in keyof T]: FormFieldWire<T[K]> } : FormFieldWire<T>;

export interface Format<Raw = string, F extends WireFn = WireFn> {
  contentType: string;
  /** How the adapter reads the body from the platform: text(), arrayBuffer() or formData(). */
  unit: 'text' | 'bytes' | 'form';
  decode(raw: Raw): unknown;
  encode(value: unknown): Raw;
  /** Фантом wire-эффекта (runtime-поля нет). */
  readonly __wire?: F;
}

/** Фантом формата в типе эндпоинта: клиент выводит F отсюда и сверяет формат транспорта. */
export interface FormatTag<F extends WireFn> {
  readonly __format?: F;
}