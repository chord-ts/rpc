// Bottom shared contracts — only what crosses non-adjacent layers. Layer-owned types live in
// their layers: core/types (gasket, fn, DI, CoreError), format/types (Format), tools/types
// (AgentTool), protocol/jsonrpc/types (RPC wire). This module imports nothing above itself.
// `readonly` omitted + `ReadonlyArray` used: SWC 1.5.5 fails to parse `readonly`
// inside a string-keyed nested method signature.

// --- Schema contract (vendor minimum of the Standard Schema v1 interface) ---
// zod 4 / valibot / arktype implement this shape; yup needs a shim adapter.
// Stays at the bottom: core (below schemas runtime) declares Contract over AnySchema.
type ValidateResult<Output> = { value: Output } | { issues: ReadonlyArray<unknown> };

export interface AnySchema<Output = unknown> {
  '~standard': {
    version: 1;
    vendor: string;
    validate(value: unknown): ValidateResult<Output> | Promise<ValidateResult<Output>>;
  };
}

export type InferOutput<S extends AnySchema> = S extends AnySchema<infer O> ? O : never;

// --- Vendor schema adapter (registered once in compose; read by generate/tools/protocol) ---
/** Минимальный интерфейс адаптера: конвертация схемы в JSON Schema — единственное, что нужно
 * генерации спеков (openapi/openrpc/mcpTools/asyncapi). Плоские схемы тулов строятся generic
 * ~standard-билдерами (schemas), вендорных методов в интерфейсе нет. */
export interface SchemaAdapter {
  jsonSchema(schema: AnySchema): unknown;
}

/** REST metadata (shared with generate — generate is below protocol, so the contract stays here).
 * Declaration sugar lives in protocol/rest. */
export interface RestMeta {
  method: string;
  endpoint: string;
  status?: number;
}

// --- Transport seam, value-level (structural, zero-dep: no DOM/node types) ---
// Stays at the bottom: protocol implements Binding, transport consumes it — putting the seam
// in either layer would create an upward import. The seam carries VALUES, not raw wire: the
// generic transport adapter reads raw (text/bytes/formData) and decodes via Format into body,
// then encodes the response value back. Raw text/bytes are a codec+adapter detail, not the seam.
export interface TransportRequest {
  method: string; // HTTP method
  url: string; // full URL (pathname + query)
  body: unknown; // parsed request value (adapter × Format, or early-extracted by the user)
}
export interface TransportResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown; // response value — the adapter encodes it with Format
  raw?: boolean; // escape: body is final (docs text/html, openapi.json) — bypass the codec
}
/** Protocol binding: parsed request + ctx → response value. Transport picks the binding explicitly. */
export interface Binding {
  handle(req: TransportRequest, ctx?: unknown): Promise<TransportResponse>;
}


// --- Interaction models (transport vocabulary, not per-protocol contracts) ---
// A binding is a transport interaction model: transport-addressed (http), self-addressed
// (message), stream. Protocols declare their nature once and hand adapters the contract they
// need — projections. Adapters stay stable and protocol-agnostic: each consumes its own view.
// New models are added additively (new seam + projection); existing code does not change.

/** Self-addressed seam: parsed message + ctx → reply value; null = no reply (notification). */
export interface MessageBinding {
  handle(value: unknown, ctx?: unknown): Promise<unknown | null>;
}
/** HTTP projection — what HTTP adapters (fromSvelteKit/fromExpress) require. */
export interface HttpProtocol {
  http: Binding;
}
/** Self-addressed protocol: native message seam + built-in HTTP projection (messageToHttp). */
export interface MessageProtocol extends HttpProtocol {
  message: MessageBinding;
}
/** Stream seam: subscription value + ctx → event iterable. Cancellation is native to the
 * iterator (return()/throw() → generator finally-cleanup); errors propagate as native throw. */
export interface StreamBinding {
  handle(value: unknown, ctx?: unknown): AsyncIterable<unknown>;
}
/** Stream projection — what stream adapters (fromWsStream) require. */
export interface StreamProtocol {
  stream: StreamBinding;
}

// --- Client typing phantom ---
// A protocol binding carries its service map so the client can extract typed methods from the
// binding type (client<typeof api> / protocol.client<typeof api>). Type-only: no runtime field.
// S is unconstrained here (bottom layer); factories constrain it to ServiceMap at the use site.
export interface ServiceTag<S> {
  readonly __services?: S;
}