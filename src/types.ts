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