// Core layer contracts: gasket, schema-first declaration, DI, native error, client projection.
// Imports only the bottom shared contracts (AnySchema/SchemaAdapter) — no upper layers.

import type { AnySchema, InferOutput, SchemaAdapter, McpMeta } from '../types';

// --- Native error: protocol-neutral, bindings map kind to their wire ---
/** Protocol-neutral failure kinds of the core gasket. Bindings map them to their own
 * wire codes/statuses (jsonrpc: -32601/-32602/-32603; rest: 422/500; …). */
export type CoreErrorKind = 'not-found' | 'invalid-params' | 'invalid-output';

/** Core's own error (native throw): pipeline failures only (not found, validation).
 * Handler errors propagate untouched. Protocol-specific errors (RpcError with JSON-RPC
 * codes) live in the protocol layer, not here. */
export class CoreError extends Error {
  constructor(
    public kind: CoreErrorKind,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'CoreError';
  }
}

// --- Middleware contract: onion `(ctx, next) => value`, errors via throw ---
export type Middleware<Ctx = unknown> = (
  ctx: Ctx,
  next: (ctx: Ctx) => Promise<unknown>
) => Promise<unknown>;

export type MaybeArray<T> = T | T[];

// --- schema-first contract + `fn` ---
export type Contract = {
  in: AnySchema<any>;
  out?: AnySchema<any>;
  /** stream-декларация: схема события (вместо out); наличие отличает stream-эндпоинт. */
  event?: AnySchema<any>;
  use?: MaybeArray<Middleware<any>>;
  /** Нейтральная мета для генераторов (OpenRPC/OpenAPI): описание (GFM), краткая метка, теги,
   * deprecated. Протокол-специфичная мета — в карманах (mcp/rest); при конфликте приоритет у кармана. */
  desc?: string;
  summary?: string;
  tags?: string[];
  deprecated?: boolean;
  /** MCP-декорация тула (name/title/desc/annotations/icons/_meta + расширения). Приоритет над нейтральной. */
  mcp?: McpMeta;
};

export type Out<C extends Contract> = C['out'] extends AnySchema<infer O> ? O : unknown;

// Tuple (фиксированная длина) → позиционные аргументы обработчика (провод [a, b]);
// обычный массив — одиночное значение-массив (провод [[…]]); объект/скаляр — одиночный вход.
type HandlerArgs<I> = I extends unknown[] ? (number extends I['length'] ? [I] : I) : [I];
/** Сигнатура обработчика, выведенная из контракта: аргументы из `in`, возврат из `out`. */
export type Handler<C extends Contract> = (...args: HandlerArgs<InferOutput<C['in']>>) => Promise<Out<C>>;
export type Fn<C extends Contract> = C & {
  fn: Handler<C>;
  /** Callable-декларация: `$method(handler)` контекстно типизирует обработчик и возвращает его как есть. */
  (handler: Handler<C>): Handler<C>;
};

// --- schema-first stream declaration + `stream` ---
export type StreamContract = {
  in: AnySchema<any>;
  event: AnySchema<any>;
  use?: MaybeArray<Middleware<any>>;
  desc?: string;
};

/** Сигнатура stream-обработчика: async-генератор (input, signal) → события. */
export type StreamHandler<C extends StreamContract> = (
  input: InferOutput<C['in']>,
  signal: AbortSignal,
) => AsyncIterable<InferOutput<C['event']>>;
/** Фантомный тип обработчика + callable-декларация: `$method(handler)` — identity-возврат. */
export type StreamFn<C extends StreamContract> = C & {
  fn: StreamHandler<C>;
  (handler: StreamHandler<C>): StreamHandler<C>;
};

export type StreamOpts = { ctx?: unknown; signal?: AbortSignal };

// --- DI + Client types ---
export type AnyCtor = new (...args: any[]) => any;

export type ServiceMap = Record<string, AnyCtor>;

// DI deps are the public data fields of the instance (constructor parameter properties
// declared `public readonly`/`readonly`); arrow-field methods are filtered out.
export type DepKeyOf<C extends AnyCtor> = {
  [K in keyof InstanceType<C>]: InstanceType<C>[K] extends (...args: any[]) => any ? never : K;
}[keyof InstanceType<C>] & string;

export type DepKeys<S extends ServiceMap> = { [K in keyof S]: DepKeyOf<S[K]> }[keyof S];

export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

export type DepType<S extends ServiceMap, K> = UnionToIntersection<
  { [Svc in keyof S]: InstanceType<S[Svc]> extends infer I ? (K extends keyof I ? I[K] : never) : never }[keyof S]
>;

/** DI factories keyed by dependency name; the return type must match the injected dependency. */
export type Injector<S extends ServiceMap, Ctx = any> = {
  [K in DepKeys<S>]: (ctx: Ctx) => DepType<S, K>;
};

export type Instantiated<S extends ServiceMap> = { [K in keyof S]: InstanceType<S[K]> };

export type MethodKeys<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never }[keyof T];
export type RemoteMethod<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
export type RemoteService<T> = { [K in MethodKeys<T>]: RemoteMethod<T[K]> };
/** Remote (transport) client type: public arrow fields only, returns wrapped in Promise.
 * Lives here until the client layer lands (type-level projection of services, no runtime). */
export type Client<S extends ServiceMap> = { [K in keyof S]: RemoteService<InstanceType<S[K]>> };

// --- Internal dispatch shapes ---
export type Call = { method: string; params: unknown };
export type MethodDesc = {
  service: string;
  method: string;
  contract: Contract | null;
  use: Middleware[];
  /** Wire params spreading: true = tuple (positional args), false = array-as-single-value,
   * undefined = unclassified (fall back to the bare-array heuristic). Set at compose from the
   * input JSON Schema (prefixItems ⇒ tuple). */
  positional?: boolean;
};

// --- Protocol-neutral core gasket ---
/** Registry entry: one endpoint. `contract` carries in/out/use + protocol metadata fields
 * (rest/mcp/…) passed to fn. `null` = simple endpoint without a schema. */
export interface Endpoint {
  service: string;
  method: string;
  contract: (Contract & Record<string, unknown>) | null;
}

/** Protocol-agnostic core: verbs + registry + the registered schema adapter.
 * Verbs return the value and throw natively (CoreError for pipeline failures, handler errors
 * as-is). stream yields bare events (AsyncIterable); cancellation is native — signal.aborted →
 * AbortError, consumer return()/break → generator finally-cleanup. No exec/envelope, no tools() —
 * those live in upper layers (protocol/jsonrpc, tools). */
export interface Core<S extends ServiceMap> {
  instantiate(ctx: unknown): Instantiated<S>;
  call(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<unknown>;
  notify(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<void>;
  stream(method: string, params: unknown, opts?: StreamOpts): AsyncIterable<unknown>;
  endpoints(): readonly Endpoint[];
  /** Composer-level middleware onion around an arbitrary terminal. `rpc.discover` goes through it
   * so a blocking guard covers discovery too. Per-endpoint `use` is applied by call/stream, not here. */
  run<T>(ctx: unknown, terminal: (ctx: unknown) => Promise<T>): Promise<T>;
  schemas?: SchemaAdapter;
}

/** inject обязателен только когда у сервисов есть зависимости (DepKeys); для сервисов без
 * зависимостей его можно опустить: `compose({ Service })`. */
export type ComposeOptions<S extends ServiceMap> = {
  use?: MaybeArray<Middleware<any>>;
  schemas?: SchemaAdapter;
  /** Opt-in runtime validation of handler output against `out` (default false).
   * `out` always provides the return type; this flag gates the runtime check. */
  validateOut?: boolean;
} & ([DepKeys<S>] extends [never] ? { inject?: Injector<S> } : { inject: Injector<S> });