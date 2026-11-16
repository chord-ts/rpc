// Shared contracts of v2 — the bottom import layer. Pure types + dep-free constants.
// Every layer imports from here; this module imports nothing above itself.
// `readonly` omitted + `ReadonlyArray` used: SWC 1.5.5 fails to parse `readonly`
// inside a string-keyed nested method signature.

// --- Schema contract (vendor minimum of the Standard Schema v1 interface) ---
// zod 4 / valibot / arktype implement this shape; yup needs a shim adapter.
type ValidateResult<Output> = { value: Output } | { issues: ReadonlyArray<unknown> };

export interface AnySchema<Output = unknown> {
  '~standard': {
    version: 1;
    vendor: string;
    validate(value: unknown): ValidateResult<Output> | Promise<ValidateResult<Output>>;
  };
}

export type InferOutput<S extends AnySchema> = S extends AnySchema<infer O> ? O : never;

// --- Result error codes (JSON-RPC 2.0 numbering, used as generic Result codes) ---
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// --- Typed result: no exceptions escape the pipeline ---
export type ErrorObject = { code: number; message: string; data?: unknown; status?: number };

export type Result<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorObject };

// --- Middleware contract: onion `(ctx, next) => Result` ---
export type Middleware<Ctx = unknown> = (
  ctx: Ctx,
  next: (ctx: Ctx) => Promise<Result>
) => Promise<Result>;

export type MaybeArray<T> = T | T[];

// --- schema-first contract + `fn` ---
export type Contract = {
  in: AnySchema<any>;
  out?: AnySchema<any>;
  use?: MaybeArray<Middleware<any>>;
};

export type Out<C extends Contract> = C['out'] extends AnySchema<infer O> ? O : unknown;

export type Fn<C extends Contract> = C & {
  fn: (input: InferOutput<C['in']>) => Promise<Out<C>>;
};

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
/** Remote (transport) client type: public arrow fields only, returns wrapped in Promise. */
export type Client<S extends ServiceMap> = { [K in keyof S]: RemoteService<InstanceType<S[K]>> };

// --- JSON-RPC wire shapes ---
export type RPCId = string | number | null;

export interface RPCRequest {
  method: string;
  params?: unknown;
  id?: RPCId;
}

export interface RPCResponse {
  jsonrpc: '2.0';
  id: RPCId;
  result?: unknown;
  error?: ErrorObject;
}

export type RPCBody = RPCRequest | RPCRequest[];

export type Call = { id: RPCId; method: string; params: unknown };
export type MethodDesc = { service: string; method: string; contract: Contract | null; use: Middleware[] };

// --- Vendor schema adapter (registered once in compose; read by generate/tools/protocol) ---
/** Operations over the validation library, resolved under the hood by one vendor adapter. */
export interface SchemaAdapter {
  jsonSchema(schema: AnySchema): unknown;
  isObject(schema: AnySchema): boolean;
  /** Flat object schema from REST parts + named extra fields (auto-path). */
  flatObject(parts: AnySchema[], extra: Record<string, AnySchema>): AnySchema;
  /** Scalar → { value: T } (MCP/LangChain require an object schema). */
  wrapScalar(schema: AnySchema): AnySchema;
  string(): AnySchema;
}

// --- Protocol-neutral core gasket ---
/** Registry entry: one endpoint. `contract` carries in/out/use + protocol metadata fields
 * (rest/mcp/…) passed to fn. `null` = simple endpoint without a schema. */
export interface Endpoint {
  service: string;
  method: string;
  contract: (Contract & Record<string, unknown>) | null;
}

/** Protocol-agnostic core: verbs + registry + the registered schema adapter.
 * No exec/envelope, no tools() — those live in upper layers (protocol/jsonrpc, tools). */
export interface Core<S extends ServiceMap> {
  instantiate(ctx: unknown): Instantiated<S>;
  call(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<Result>;
  notify(method: string, params: unknown, opts?: { ctx?: unknown }): Promise<void>;
  endpoints(): readonly Endpoint[];
  schemas?: SchemaAdapter;
}

export interface ComposeOptions<S extends ServiceMap> {
  inject: Injector<S>;
  use?: MaybeArray<Middleware>;
  schemas?: SchemaAdapter;
}

/** REST metadata (shared with generate). Declaration sugar lives in protocol/rest. */
export interface RestMeta {
  method: string;
  endpoint: string;
  status?: number;
}

// --- Format: codec pair over the protocol envelope (text seam; binary formats extend it later) ---
export interface Format {
  contentType: string;
  decode(raw: string): unknown;
  encode(value: unknown): string;
}

// --- Agent tool: ready for agent frameworks (LangChain etc.), in-process, no wire ---
export interface AgentTool {
  name: string;
  description: string;
  /** Vendor flat schema — e.g. DynamicStructuredTool.schema in LangChain. */
  schema: AnySchema;
  inputSchema: unknown;
  annotations?: Record<string, boolean>;
  invoke(args: unknown, ctx?: unknown): Promise<Result>;
  /** Ready framework call: string result (LangChain func). */
  func(args: unknown): Promise<string>;
}

// --- Transport seam (structural, zero-dep: core needs no DOM/node types) ---
export interface TransportRequest {
  method: string; // HTTP method
  url: string; // full URL (pathname + query)
  text(): Promise<string>;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}
/** Protocol binding: raw request + ctx → raw response. Transport picks the binding explicitly. */
export interface Binding {
  handle(req: TransportRequest, ctx?: unknown): Promise<TransportResponse>;
}

// --- Legacy JSON-RPC composer (toRPC): Core + exec envelope. Kept for backward compat;
// exec moves to protocol/jsonrpc in the layered migration. ---
export interface Composer<S extends ServiceMap> extends Core<S> {
  exec(body: RPCBody, opts?: { ctx?: unknown }): Promise<RPCResponse | RPCResponse[] | undefined>;
}

export interface ToRPCOptions<S extends ServiceMap> {
  inject: Injector<S>;
  use?: MaybeArray<Middleware>;
  schemas?: SchemaAdapter;
}